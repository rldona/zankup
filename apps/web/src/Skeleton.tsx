/**
 * Placeholders while data loads (OS-905), as the app's: grey shapes where the content will be, pulsing
 * softly as one block, so what arrives replaces them without the layout jumping. Each block is marked
 * busy with a hidden "Loading…" for screen readers.
 */
import type { CSSProperties, ReactNode } from 'react';

import { t } from './i18n';

export function Pulse({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`pulse${className ? ` ${className}` : ''}`} aria-busy="true">
      <span className="visually-hidden" role="status">
        {t('common.loading')}
      </span>
      {children}
    </div>
  );
}

export function Bone({
  width = '100%',
  height = 12,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: CSSProperties;
}) {
  return <i className="bone" style={{ width, height, borderRadius: radius, ...style }} />;
}

function CardBox({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="panel bonecard" style={{ gap }}>
      {children}
    </div>
  );
}

const Row = ({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap, ...style }}>{children}</div>
);

const Col = ({ children, gap = 6, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) => (
  <div style={{ display: 'grid', gap, ...style }}>{children}</div>
);

/** A card with a title and a few lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <CardBox>
      <Bone width="45%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </CardBox>
  );
}

/** A goal card: the name, the bar, the figures and the projection, at the card's real height. */
export function GoalSkeleton() {
  return (
    <div className="panel goalcard bonecard" style={{ gap: 16 }}>
      <Bone width="45%" height={16} />
      <Bone height={8} radius={4} />
      <Bone width="60%" height={18} />
      <Bone width="80%" />
    </div>
  );
}

/** A screen of cards: what a list or a page looks like before it loads. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Pulse className="page">
      {Array.from({ length: cards }, (_, i) => (
        <CardSkeleton key={i} lines={i === 0 ? 2 : 3} />
      ))}
    </Pulse>
  );
}

/** One activity in the feed: the sport tile, the name and date, three figures and the route. */
function ActivityBone() {
  return (
    <CardBox gap={14}>
      <Row>
        <Bone width={36} height={36} radius={10} />
        <Col style={{ flex: 1 }}>
          <Bone width="60%" height={14} />
          <Bone width="35%" height={10} />
        </Col>
      </Row>
      <Row gap={16} style={{ alignItems: 'flex-end' }}>
        {[0, 1, 2].map((i) => (
          <Col key={i}>
            <Bone width={48} height={9} />
            <Bone width={60} height={16} />
          </Col>
        ))}
        <Bone width={84} height={56} radius={10} style={{ marginLeft: 'auto' }} />
      </Row>
    </CardBox>
  );
}

export function FeedSkeleton() {
  return (
    <Pulse>
      {[0, 1, 2, 3].map((i) => (
        <ActivityBone key={i} />
      ))}
    </Pulse>
  );
}

/** An activity before it loads: the title, the figures, the map and a card. */
export function ActivitySkeleton() {
  return (
    <Pulse className="page detail">
      <Row>
        <Bone width={44} height={44} radius={12} />
        <Col style={{ flex: 1 }}>
          <Bone width="55%" height={18} />
          <Bone width="35%" height={10} />
        </Col>
      </Row>
      <Row gap={24} style={{ margin: '18px 0' }}>
        {[0, 1, 2, 3].map((i) => (
          <Col key={i}>
            <Bone width={70} height={9} />
            <Bone width={80} height={18} />
          </Col>
        ))}
      </Row>
      <Bone height={320} radius={16} style={{ marginBottom: 14 }} />
      <CardSkeleton lines={2} />
    </Pulse>
  );
}

/** A chart's card: a title and the plot. */
export function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <CardBox>
      <Bone width="50%" height={16} />
      <Bone height={height} radius={10} />
    </CardBox>
  );
}

/** Health before it loads: last night, the day's figures and a chart. */
export function HealthSkeleton() {
  return (
    <Pulse>
      <CardSkeleton lines={3} />
      <div className="bonepair">
        <CardSkeleton lines={1} />
        <CardSkeleton lines={1} />
      </div>
      <ChartSkeleton />
    </Pulse>
  );
}
