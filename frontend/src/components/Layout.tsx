import { NavLink, Outlet } from 'react-router-dom';

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
              S
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
          Fontes RSS publicas + resumo por IA. Conteúdo e resumo pertencem aos respectivos autores; a
          marcação de resumo indica texto gerado por modelo.
        </div>
      </footer>
    </div>
  );
}
