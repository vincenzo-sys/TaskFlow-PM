/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@taskflow/shared'],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://xteoofowswtvtxgroxog.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0ZW9vZm93c3d0dnR4Z3JveG9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4OTY2MjcsImV4cCI6MjA4NzQ3MjYyN30.oc3yun0DeG9XLjhFXql6blZZqNSJfm3vowIwKgyT1K0',
  },
};

module.exports = nextConfig;
