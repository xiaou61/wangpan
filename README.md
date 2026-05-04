# 资料渡口 - 网盘资料展示系统

一个轻量的网盘资料展示页，包含响应式用户端和后台端。

## 功能

- 前台：资料搜索、分类筛选、夸克/百度筛选、移动端适配。
- 后台：登录、资料管理、分类管理、访客记录、具体网盘地址打开数据。
- 数据大屏：后台总览展示今日访客、今日打开、趋势图、热门资料、热门地址、设备/浏览器分布和实时动态。
- 统计：访问首页会记录访客，点击网盘按钮会先经过 `/go/:resourceId/:linkId` 记录打开次数再跳转。
- 数据：默认使用 `data/db.json` 本地 JSON 文件存储，首次启动会从 `data/seed.json` 初始化。

## 启动

```powershell
npm install
$env:PORT="3003"
$env:ADMIN_USERNAME="yuanfang"
$env:ADMIN_PASSWORD="lizifan0"
$env:SESSION_SECRET="换成至少32位随机字符串"
npm start
```

打开：

- 前台：http://localhost:3003/
- 后台：http://localhost:3003/yuanfang

## 验证

服务启动后可以运行：

```powershell
$env:TEST_BASE_URL="http://localhost:3003"
$env:ADMIN_USERNAME="yuanfang"
$env:ADMIN_PASSWORD="lizifan0"
npm run verify
```

验证会检查前台桌面/手机页面、后台登录、新增资料、前台搜索和测试数据清理。

## 后台说明

默认后台账号密码是 `yuanfang / lizifan0`。如果要覆盖默认值，可以通过环境变量设置 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。

同一 IP 连续输错 3 次后，会被锁定 24 小时，期间不能继续重试。

生产部署时请同时设置：

- `ADMIN_USERNAME`：后台账号。
- `ADMIN_PASSWORD`：后台密码。
- `SESSION_SECRET`：至少 32 位随机字符串。
- `NODE_ENV=production`：让 Cookie 使用更严格的安全设置。

## 数据文件

- `data/seed.json`：初始示例分类和资料。
- `data/db.json`：运行时真实数据，包含资料、分类、访客记录、打开记录，已加入 `.gitignore`。
