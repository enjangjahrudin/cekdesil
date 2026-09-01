module.exports = {
  apps: [
    {
      name: 'cekdesil-app',
      script: 'src/server.js',
      cwd: '/www/wwwroot/cekdesil.buatdigital.id',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3003
      }
    }
  ]
};
