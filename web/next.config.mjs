/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy /api/* para o backend Fastify — evita CORS e mantém URLs relativas.
  async rewrites() {
    // Remove barra final para não gerar //api//rota quando a URL vem com trailing slash.
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn(
    '⚠️  NEXT_PUBLIC_API_URL não definida.\n' +
    '   Chamadas de API no SSR vão falhar em produção.\n' +
    '   Configure NEXT_PUBLIC_API_URL=https://<backend>.onrender.com no projeto Vercel.',
  );
}

export default nextConfig;
