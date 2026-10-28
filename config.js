/*
 * 游戏中心配置（可自行修改）
 * statsEndpoint: 统计接口。默认 './api/stats'，由 stats_server.py 提供；
 *                纯静态托管时会 404，页面自动降级为「本机统计」。
 * refreshMs:     服务端统计刷新间隔（毫秒）。
 * scan:          是否在运行时扫描目录，发现未登记在 games.js 里的新游戏。
 */
window.GAME_CENTER_CONFIG = {
  statsEndpoint: './api/stats',
  refreshMs: 30000,
  scan: true
};
