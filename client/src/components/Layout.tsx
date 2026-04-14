import { NavLink, Outlet } from 'react-router-dom';
import { useDashboard } from '../hooks/useApi';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '◫' },
  { to: '/discovery', label: 'Discovery', icon: '🔍' },
  { to: '/portfolio', label: 'Portfolio', icon: '◉' },
  { to: '/trades', label: 'Trades', icon: '⇄' },
  { to: '/analysis', label: 'Analysis', icon: '◈' },
  { to: '/activity', label: 'Activity Log', icon: '▤' },
] as const;

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function formatPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function Layout() {
  const { data } = useDashboard();
  const portfolio = data?.data?.portfolio;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 'var(--sidebar-width)',
        minWidth: 'var(--sidebar-width)',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-primary)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 10,
      }}>
        {/* Brand */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
        }}>
          <span style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: 'var(--accent)',
            letterSpacing: '-0.02em',
          }}>◆</span>
          <span style={{
            fontSize: '1.15rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--text-primary)',
          }}>APEX</span>
          <span style={{
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            background: 'var(--bg-tertiary)',
            padding: '0.1rem 0.4rem',
            borderRadius: '4px',
            marginLeft: 'auto',
          }}>v0.1</span>
        </div>

        {/* Navigation */}
        <nav style={{ padding: '0.75rem 0', flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.65rem 1.5rem',
                textDecoration: 'none',
                fontSize: '0.9rem',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent-bg)' : 'transparent',
                borderRight: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s',
              })}
            >
              <span style={{ fontSize: '1rem', width: '1.25rem', textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer status */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-primary)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
            <span className="status-dot status-active" />
            <span>Autonomous Agent</span>
          </div>
          <div>Runs every 4 hours</div>
        </div>
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, marginLeft: 'var(--sidebar-width)', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <header style={{
          height: 'var(--header-height)',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 2rem',
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Autonomous Stock-Picking Agent
          </div>
          {portfolio && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Portfolio Value
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {formatCurrency(portfolio.total_value)}
                </div>
              </div>
              <div style={{
                padding: '0.25rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                background: portfolio.total_pnl >= 0 ? 'var(--profit-bg)' : 'var(--loss-bg)',
                color: portfolio.total_pnl >= 0 ? 'var(--profit)' : 'var(--loss)',
              }}>
                {formatPct(portfolio.total_pnl_pct)}
              </div>
            </div>
          )}
        </header>

        {/* Page content */}
        <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1400px', width: '100%' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
