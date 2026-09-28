import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ApiError } from './api/client';
import { Layout } from './components/Layout';
import { ErrorBox } from './components/States';
import { CategoriesPage } from './pages/CategoriesPage';
import { NewsDetailPage } from './pages/NewsDetailPage';
import { NewsListPage } from './pages/NewsListPage';
import { SourcesPage } from './pages/SourcesPage';
import './styles/tokens.css';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function NotFound() {
  return <ErrorBox message="Pagina nao encontrada." />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <NewsListPage /> },
      { path: 'noticias/:id', element: <NewsDetailPage /> },
      { path: 'categorias', element: <CategoriesPage /> },
      { path: 'fontes', element: <SourcesPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root nao encontrado');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
