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
        PORT: 3003,
        WARP_PROXY: 'socks5://127.0.0.1:40000'
      }
    }
  ]
};
