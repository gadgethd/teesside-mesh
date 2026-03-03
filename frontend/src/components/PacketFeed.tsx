import React from 'react';
import type { AggregatedPacket, MeshNode } from '../hooks/useNodes.js';

const TYPE_LABELS: Record<number, string> = {
  0:  'REQ',
  1:  'RSP',
  2:  'DM',
  3:  'ACK',
  4:  'ADV',
  5:  'GRP',
  6:  'DAT',
  7:  'ANON',
  8:  'PATH',
  9:  'TRC',
};

interface Props {
  packets: AggregatedPacket[];
  nodes:   Map<string, MeshNode>;
}

export const PacketFeed: React.FC<Props> = React.memo(({ packets, nodes }) => (
  <div className={`packet-feed${packets.length >= 7 ? ' packet-feed--overflow' : ''}`}>
    {packets.slice(0, 7).map((p) => {
      const typeLabel = p.packetType !== undefined
        ? (TYPE_LABELS[p.packetType] ?? `T${p.packetType}`)
        : '???';

      const rawContent = p.summary
        ?? (p.rxNodeId ? nodes.get(p.rxNodeId)?.name : undefined);
      const content = rawContent?.includes('🚫') ? '[redacted]' : rawContent;
      const display = content && content.length > 28
        ? `${content.slice(0, 26)}…`
        : content;

      const advertBadge = p.packetType === 4 && typeof p.advertCount === 'number'
        ? (p.advertCount === 1 ? 'NEW' : `${p.advertCount}`)
        : undefined;

      return (
        <div key={p.id} className="packet-item">
          <span className="packet-item__type">{typeLabel}</span>
          {advertBadge && (
            <span className="packet-item__advert-badge">{advertBadge}</span>
          )}
          {display && (
            <span className="packet-item__summary">{display}</span>
          )}
          {p.hopCount !== undefined && p.hopCount > 0 && (
            <span className="packet-item__hops">↑{p.hopCount}</span>
          )}
          <span className="packet-item__counts">
            {p.rxCount > 0 && <span className="count count--rx">{p.rxCount}rx</span>}
            {p.txCount > 0 && <span className="count count--tx">{p.txCount}tx</span>}
          </span>
        </div>
      );
    })}
  </div>
));
