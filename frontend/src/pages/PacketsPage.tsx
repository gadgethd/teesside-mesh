import React from 'react';

interface PacketTypeEntry {
  code:    string;
  name:    string;
  label:   string;
  desc:    string;
  detail?: string;
}

const PACKET_TYPES: PacketTypeEntry[] = [
  {
    code:   'ADV',
    name:   'Advert',
    label:  'Type 4',
    desc:   'A node announcing itself to the network.',
    detail: 'Adverts are broadcast periodically by every MeshCore node. They carry the node\'s name, '
          + 'its GPS position (if available), and its device role. Repeaters use adverts to stay visible '
          + 'to the rest of the network. On the live map, an Advert arriving from a node you\'ve not seen '
          + 'before is what causes it to appear for the first time.',
  },
  {
    code:   'GRP',
    name:   'Group Text',
    label:  'Type 5',
    desc:   'A message sent to a channel, visible to everyone on that channel.',
    detail: 'Group Text packets are encrypted with a shared channel key. The default MeshCore public channel '
          + 'uses a well-known key, so anyone on the network can read public messages. Private channels use '
          + 'a different key known only to members. On the dashboard the sender name and message content are '
          + 'shown in the live feed, prefixed with the channel name in brackets.',
  },
  {
    code:   'DM',
    name:   'Text Message',
    label:  'Type 2',
    desc:   'A direct, private message sent to a specific node.',
    detail: 'Text Messages are encrypted to the recipient\'s public key using asymmetric cryptography. '
          + 'Only the intended recipient can decrypt the content. The dashboard can see that a DM was sent '
          + 'and which nodes were involved, but the message text itself stays private.',
  },
  {
    code:   'ACK',
    name:   'Acknowledgement',
    label:  'Type 3',
    desc:   'A receipt confirming a message was delivered.',
    detail: 'When a node successfully receives a Direct Message or Group Text, it sends an Ack back to the '
          + 'sender. The Ack contains a checksum of the original message so the sender can confirm which '
          + 'packet was received. Seeing an Ack on the live feed means a delivery was confirmed across the '
          + 'mesh.',
  },
  {
    code:   'REQ',
    name:   'Request',
    label:  'Type 0',
    desc:   'A route discovery or resource request sent to a specific node.',
    detail: 'Requests are used to find a path to a destination node or to ask it for something (such as '
          + 'stored messages from a Room Server). The network relays the request hop by hop until it reaches '
          + 'the target.',
  },
  {
    code:   'RSP',
    name:   'Response',
    label:  'Type 1',
    desc:   'A reply to a Request.',
    detail: 'Responses carry the answer back to the node that sent the original Request. They travel the '
          + 'reverse relay path where possible, making use of the route that was just discovered.',
  },
  {
    code:   'TRC',
    name:   'Trace',
    label:  'Type 9',
    desc:   'A diagnostic packet that maps the full relay path across the network.',
    detail: 'A Trace is sent deliberately to discover exactly which nodes relayed a packet and what the '
          + 'signal quality was at each hop. The response lists every relay node\'s ID prefix and the SNR '
          + 'value measured at that hop. On the live map, a Trace arriving is what triggers the dotted '
          + 'path line showing the relay chain.',
  },
  {
    code:   'PATH',
    name:   'Path',
    label:  'Type 8',
    desc:   'Path information embedded in a routed packet.',
    detail: 'Path packets carry routing information about how many hops a transmission has taken and which '
          + 'nodes it passed through. This is used internally by the mesh to build up knowledge of the '
          + 'network topology.',
  },
  {
    code:   'ANON',
    name:   'Anonymous Request',
    label:  'Type 7',
    desc:   'A request that exposes only the sender\'s public key, not their identity.',
    detail: 'Anonymous Requests allow a node to initiate contact with another without first having exchanged '
          + 'contact details. The sender\'s public key is included in clear so the recipient can reply, but '
          + 'no name or other metadata is attached.',
  },
  {
    code:   'DAT',
    name:   'Group Data',
    label:  'Type 6',
    desc:   'Binary data broadcast to a channel.',
    detail: 'Group Data packets work like Group Text but carry arbitrary binary payloads rather than '
          + 'human-readable messages. They are used by applications that need to share structured data '
          + 'across the mesh, such as sensor readings or telemetry.',
  },
];

const PacketCard: React.FC<PacketTypeEntry> = ({ code, name, label, desc, detail }) => (
  <div className="packet-card">
    <div className="packet-card__header">
      <span className="packet-card__code">{code}</span>
      <div>
        <span className="packet-card__name">{name}</span>
        <span className="packet-card__label">{label}</span>
      </div>
    </div>
    <p className="packet-card__desc">{desc}</p>
    {detail && <p className="packet-card__detail">{detail}</p>}
  </div>
);

export const PacketsPage: React.FC = () => (
  <>
    <section className="site-page-hero">
      <div className="site-content">
        <h1 className="site-page-hero__title">Packet Types</h1>
        <p className="site-page-hero__sub">
          Every transmission on the MeshCore network is a packet. Each packet has a type that tells
          the network what it contains and how to handle it.
        </p>
      </div>
    </section>

    <div className="site-content site-prose">

      <section className="prose-section">
        <p>
          MeshCore packets are the building blocks of everything that happens on the network. Whether
          you are sending a message, discovering a route, or just letting other nodes know you exist,
          there is a specific packet type for it. The live feed on the{' '}
          <a href="https://app.teessidemesh.com">dashboard</a> shows these abbreviated codes in real
          time as packets are heard by our observer node.
        </p>
      </section>

      <section className="prose-section">
        <div className="packet-grid">
          {PACKET_TYPES.map((pt) => (
            <PacketCard key={pt.code} {...pt} />
          ))}
        </div>
      </section>

      <section className="prose-section">
        <h2>How packets travel</h2>
        <p>
          Every packet on the network includes a <strong>hop count</strong> that increments each time
          a relay node rebroadcasts it. MeshCore sets a maximum hop count (typically 3 to 5) to
          prevent packets from circulating indefinitely. The dashboard shows the hop count alongside
          each packet in the live feed.
        </p>
        <p>
          Because the same packet can be heard by multiple observer nodes, the dashboard deduplicates
          by packet hash. If our node hears the same packet both directly and via a relay, it appears
          once in the feed with an RX count showing how many times it was observed.
        </p>
      </section>

    </div>
  </>
);
