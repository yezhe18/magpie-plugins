# FreeLLMAPI provider for Magpie

无 npm 依赖的 HTTP 适配插件原型，将运行中的 FreeLLMAPI 接入 Magpie。它不包含 FreeLLMAPI 服务、数据库或运行时，也不自动启动它们。完整内嵌方案见交付包的 `freellmapi-kilo-analysis.md`。

## 安装

先运行 FreeLLMAPI，默认地址 `http://127.0.0.1:3001`，并从它的 Keys 页面获取 unified API key。上游厂商的 key 保留在 FreeLLMAPI 内。

将本目录保存在长期位置，从父目录执行：

```sh
magpie plugin add ./freellmapi-magpie-plugin
magpie plugin login freellmapi 1
```

输入 FreeLLMAPI 的 unified API key，再刷新模型列表。没有登录时插件返回空模型列表；不使用占位 key 假装认证成功。若 `freellmapi` 与既有 provider ID 冲突，按 `magpie plugin list` 显示的实际 ID 登录。

## 选定的接入范围

新增项目只有 FreeLLMAPI 与 Kilo。Kilo 使用 Magpie 内置 provider，不安装第二个 Kilo 插件，也不需要安装整个 Kilo Code：

```sh
magpie provider add kilo models=kilo-auto/free
```

先查看 `magpie providers`；已有 Kilo 时使用 `magpie provider set kilo models=kilo-auto/free`，避免重复添加。Kilo 是远程网关；免密免费路由仍需要联网，官方上限为每小时每 IP 200 次。此命令已在模拟 Kilo 模型接口上验证，未发送真实推理请求。

FreeLLMAPI 自带 Kilo adapter。如果通过 Magpie 直接使用 Kilo，建议把 FreeLLMAPI 链中的 Kilo 排除；两个入口不会增加同一 IP 的免费额度。也不要把 Magpie 网关作为 FreeLLMAPI 上游后，再由 Magpie 指向 FreeLLMAPI，形成循环。

## 与 AntSeed 和自己的便宜模型组成路由组

在 Magpie 界面创建一个顺序路由组，加入：

1. `freellmapi/auto`，或自己配置的免费 profile。
2. `kilo/kilo-auto/free`。
3. `antseed/<model-id>`。
4. 自己的 `<provider-id>/<model-id>`。

用实际 ID 替换占位值后，也可执行：

```sh
magpie group add budget \
  models=freellmapi/auto,kilo/kilo-auto/free,antseed/YOUR_MODEL,YOUR_PROVIDER/YOUR_MODEL \
  routing=order stays=off
```

Agent 选择 `group/budget`。顺序可自行调换；`stays=off` 让每次请求重新按顺序尝试，可能减少缓存命中。插件不会自动修改现有路由组，也不按跨平台实时单价排序。

`auto` 使用 FreeLLMAPI 自己的活动链。只有该链全部限定为免费端点时，才能把它当作免费入口；自定义付费端点、Fusion、多模型评审都不等于免费。FreeLLMAPI 的 `auto:cheap` 当前也不是跨付费平台最低价计算。

## 配置

插件 Options 接受 JSON；CLI 示例：

```sh
magpie plugin options ./freellmapi-magpie-plugin \
  '{"baseUrl":"http://127.0.0.1:3001","models":["auto:coding"],"modelMetadata":{"auto:coding":{"tools":true,"context":64000}}}'
```

命名 profile 需要先在 FreeLLMAPI 创建。`modelMetadata` 是操作者声明，应与该 profile 实际模型能力一致。

| 选项 | 默认 | 含义 |
|---|---|---|
| `baseUrl` | `FREELLMAPI_BASE_URL` 或 `http://127.0.0.1:3001` | 根 URL 或 `/v1` URL |
| `models` | 当前 ready 模型与 `auto` | 精确 ID 允许列表；命名 profile 需显式选择 |
| `modelMetadata` | 空 | 按 ID 覆盖 `tools`、`vision`、`context`、`output`；不填未知能力保持保守 |
| `discoveryTimeoutMs` | `4000` | 模型发现超时 |

认证优先使用 Magpie 保存的账户 key，未登录时可用 `FREELLMAPI_API_KEY` 环境变量。桌面运行建议保存账户，并用 Options 配置地址；不要把真实 key 写入交付包或 Options 示例。

## 行为和验证边界

- 发现接口：`/v1/models?available=true&execution_status=ready`；每次 hook 调用重新获取，不常驻监听。Magpie 缓存需按其刷新机制更新。
- 排除未配置、已耗尽的实际模型；当没有任何 ready 模型时，不暴露虚拟 `auto`。该入口仍取决于 FreeLLMAPI 的活动链是否含可用模型。
- 默认跳过 Fusion、合成 Claude-family alias 及命名 profile；允许列表可选择命名 profile。
- 保留原始模型 ID、SSE、工具调用、HTTP 错误码、响应头和取消信号，交由 Magpie 现有路由回退。
- 不虚报免费。公开模型接口缺少价格、输出上限和完整视觉能力；费用不填，名称标记 `cost unverified`。Magpie 对缺省费用字段可能显示 0，不能当作计费保证。
- 虚拟 `auto` 的工具能力来自 ready 池中是否有工具模型；所用活动链应包含该模型。命名 profile 的能力需操作者覆盖。
- HTTP 已流出文本后失败无法无缝回退；两层 router 的重试可能累积延迟。

本包未发布到 npm。Node 接口测试和真实 Magpie Go 网关配合官方 JS host 的 Node 测试替代环境验证见 `verification/`。正常 Bun 插件运行、真实 FreeLLMAPI 服务、Kilo 免费生成和 AntSeed P2P/支付仍未验收。测试替代环境不能作为生产安装方式。

```sh
npm test
```

MIT；独立实现公开 HTTP 接口适配，不包含上游 FreeLLMAPI 实现。
