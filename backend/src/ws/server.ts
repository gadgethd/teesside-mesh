import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { Redis } from 'ioredis';
import type { WSMessage, LivePacket } from '../types/index.js';
import { getNodes, getLastNPackets, getViableLinkPairs } from '../db/index.js';

const REDIS_CHANNEL = 'meshcore:live';

let pub: Redis;
let sub: Redis;

export function initWebSocketServer(httpServer: Server): WebSocketServer {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://redis:6379';

  // Two separate clients: one for pub, one for sub
  // Do NOT use lazyConnect — let ioredis manage the connect lifecycle
  pub = new Redis(redisUrl);
  sub = new Redis(redisUrl);

  pub.on('error', (e: Error) => console.error('[redis/pub] error', e.message));
  sub.on('error', (e: Error) => console.error('[redis/sub] error', e.message));

  // Subscribe only after the connection is ready to avoid
  // the INFO ready-check conflicting with subscriber mode
  sub.on('ready', () => {
    sub.subscribe(REDIS_CHANNEL, (err) => {
      if (err) console.error('[redis/sub] subscribe error', err.message);
      else console.log('[redis/sub] subscribed to', REDIS_CHANNEL);
    });
  });

  const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    verifyClient: ({ origin }: { origin: string }) => {
      // No origin header = non-browser client (allow); otherwise must be whitelisted
      return !origin || ALLOWED_ORIGINS.includes(origin);
    },
  });

  wss.on('connection', async (ws: WebSocket, _req: IncomingMessage) => {
    console.log('[ws] client connected, total:', wss.clients.size);

    // Send initial state: known nodes + last 5 minutes of packets
    try {
      const [nodes, packets, viablePairs] = await Promise.all([
        getNodes(), getLastNPackets(10), getViableLinkPairs(),
      ]);
      const initMsg: WSMessage = {
        type: 'initial_state',
        data: { nodes, packets, viable_pairs: viablePairs },
        ts: Date.now(),
      };
      ws.send(JSON.stringify(initMsg));
    } catch (err) {
      console.error('[ws] initial state error', (err as Error).message);
    }

    ws.on('close', () => {
      console.log('[ws] client disconnected, total:', wss.clients.size);
    });

    ws.on('error', (err) => {
      console.error('[ws] client error', err.message);
    });
  });

  // Fan-out Redis messages to all connected WS clients
  sub.on('message', (_channel: string, messageStr: string) => {
    if (wss.clients.size === 0) return;
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  });

  return wss;
}

export function broadcastPacket(packet: LivePacket): void {
  const msg: WSMessage = { type: 'packet', data: packet, ts: Date.now() };
  void pub.publish(REDIS_CHANNEL, JSON.stringify(msg));
}

export function broadcastNodeUpdate(nodeId: string): void {
  const msg: WSMessage = { type: 'node_update', data: { nodeId, ts: Date.now() }, ts: Date.now() };
  void pub.publish(REDIS_CHANNEL, JSON.stringify(msg));
}

export function broadcastNodeUpsert(node: Record<string, unknown>): void {
  const msg: WSMessage = { type: 'node_upsert', data: node, ts: Date.now() };
  void pub.publish(REDIS_CHANNEL, JSON.stringify(msg));
}

/** Push a viewshed calculation job for a node with a known position. */
export function queueViewshedJob(nodeId: string, lat: number, lon: number): void {
  void pub.lpush('meshcore:viewshed_jobs', JSON.stringify({ node_id: nodeId, lat, lon }));
}

/** Push a link observation job for a received packet with relay path data. */
export function queueLinkJob(
  rxNodeId: string,
  srcNodeId: string | undefined,
  pathHashes: string[],
  hopCount: number | undefined,
): void {
  if (!pathHashes.length) return;
  void pub.lpush('meshcore:link_jobs', JSON.stringify({
    rx_node_id:   rxNodeId,
    src_node_id:  srcNodeId,
    path_hashes:  pathHashes,
    hop_count:    hopCount,
  }));
}
