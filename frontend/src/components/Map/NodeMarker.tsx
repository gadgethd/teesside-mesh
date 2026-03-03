import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import type { MeshNode } from '../../hooks/useNodes.js';

const SEVEN_DAYS_MS  = 7  * 24 * 60 * 60 * 1000;

type MarkerVariant = 'repeater' | 'companion' | 'room';

// Build a custom Leaflet icon from HTML
function buildIcon(isOnline: boolean, isActive: boolean, isStale: boolean, variant: MarkerVariant): L.DivIcon {
  const classes = [
    'node-marker',
    isStale               ? 'node-marker--stale'     : '',
    !isOnline && !isStale ? 'node-marker--offline'   : '',
    isActive && !isStale  ? 'node-marker--active'    : '',
    // Colour variant only shown when online and fresh
    isOnline && !isStale && variant === 'companion' ? 'node-marker--companion' : '',
    isOnline && !isStale && variant === 'room'      ? 'node-marker--room'      : '',
  ].filter(Boolean).join(' ');
  const html = `
    <div class="${classes}">
      <div class="node-marker__core"></div>
      <div class="node-marker__pulse"></div>
    </div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize:    [12, 12],
    iconAnchor:  [6, 6],
    popupAnchor: [0, -10],
  });
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ROLE_LABELS: Record<number, string> = {
  1: 'Companion Radio',
  2: 'Repeater',
  3: 'Room Server',
  4: 'Sensor',
};

function roleVariant(role: number | undefined): MarkerVariant {
  if (role === 1) return 'companion';
  if (role === 3) return 'room';
  return 'repeater';
}

interface Props {
  node:     MeshNode;
  isActive: boolean;
}

export const NodeMarker: React.FC<Props> = React.memo(({ node, isActive }) => {
  if (!node.lat || !node.lon) return null;

  const ageMs   = Date.now() - new Date(node.last_seen).getTime();
  const isStale = ageMs > SEVEN_DAYS_MS;
  const variant = roleVariant(node.role);

  const fallbackName = ROLE_LABELS[node.role ?? 2] ?? 'Unknown Device';

  const statusLabel = isStale
    ? 'STALE'
    : node.is_online ? 'ONLINE' : 'OFFLINE';
  const statusColor = isStale
    ? 'var(--danger)'
    : node.is_online ? 'var(--online)' : 'var(--offline)';

  return (
    <Marker
      position={[node.lat, node.lon]}
      icon={buildIcon(node.is_online, isActive, isStale, variant)}
    >
      <Popup>
        <div className="node-popup">
          <div className="node-popup__name">{node.name ?? `Unknown ${fallbackName}`}</div>
          {node.role !== undefined && node.role !== 2 && (
            <div className="node-popup__row">
              <span>Type</span>
              <span>{ROLE_LABELS[node.role] ?? 'Unknown'}</span>
            </div>
          )}
          <div className="node-popup__row">
            <span>Status</span>
            <span style={{ color: statusColor }}>{statusLabel}</span>
          </div>
          {node.hardware_model && (
            <div className="node-popup__row">
              <span>Hardware</span>
              <span>{node.hardware_model}</span>
            </div>
          )}
          <div className="node-popup__row">
            <span>Last seen</span>
            <span>{timeAgo(node.last_seen)}</span>
          </div>
          {node.advert_count !== undefined && (
            <div className="node-popup__row">
              <span>Times seen</span>
              <span>{node.advert_count}</span>
            </div>
          )}
          <div className="node-popup__row">
            <span>Position</span>
            <span>{node.lat.toFixed(5)}, {node.lon.toFixed(5)}</span>
          </div>
        </div>
      </Popup>
    </Marker>
  );
});
