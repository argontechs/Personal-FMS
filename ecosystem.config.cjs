// ecosystem.config.cjs — ONE app only (no money-scheduler; scheduling is in-process)
const cwd = '/home/money/htdocs/money.argontechs.dev'
module.exports = {
  apps: [{
    name: 'money-fms',
    cwd,
    script: '.output/server/index.mjs',
    exec_mode: 'fork',
    instances: 1,
    env_file: '.env',
    env: { TZ: 'Asia/Kuala_Lumpur' },
    max_memory_restart: '400M',
    out_file: '/home/money/logs/money-fms-out.log',
    error_file: '/home/money/logs/money-fms-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
}
