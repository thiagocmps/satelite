import { NavLink, Outlet } from 'react-router-dom';
import { SatelliteIcon } from './SatelliteIcon';

const links = [
  { to: '/', label: 'Noticias', end: true },
  { to: '/categorias', label: 'Categorias', end: false },
  { to: '/fontes', label: 'Fontes', end: false },
];

export function Layout() {
  return (
    <div className="app">
      <header className="site-header">
        <div className="container site-header__inner">
          <NavLink to="/" className="brand">
            <span className="brand__mark" aria-hidden="true">
              <SatelliteIcon size={20} />
            </span>
            Satelite
          </NavLink>

          <nav className="nav" aria-label="Navegacao principal">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => (isActive ? 'is-active' : undefined)}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="site-main">
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span className="footer__signal" aria-hidden="true" />
            <span>
              Transmitido da orbita baixa — fontes RSS publicas + resumo por IA. Conteúdo e resumo
              pertencem aos respectivos autores; a marcação de resumo indica texto gerado por modelo.
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}
