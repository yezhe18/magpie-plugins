# AntSeed provider for Magpie

这是一个薄适配插件原型。它将运行中的 AntSeed 买方 HTTP 代理注册为 Magpie provider，使用稳定的自动模型路由，并可与已有渠道组成路由组。

验证范围：6 项 Node 接口测试通过；Magpie 0.1.1094 真实网关配合官方 JavaScript host 源码、Node 测试替代运行环境，通过模型注册、三个文本协议的流式回复、流式工具调用及 HTTP 402 后跨 provider 回退。当前验证容器中的 Bun 1.4.2 运行最小脚本即崩溃，因此正常 Bun 环境和真实 P2P/支付链路仍需复测。该包尚未发布到 npm。

## 前提

- 已安装支持 OpenCode provider 插件的 Magpie。
- AntSeed 买方代理已启动，默认 `http://127.0.0.1:8377`。
- `GET /v1/models?type=text` 已有卖家提供的文本模型。
- 付费服务需通过 AntSeed 自身完成身份与资金设置。身份私钥由 AntSeed 管理，不填写到本插件的 API-key 字段。

AntSeed 主仓库：<https://github.com/Antseed/antseed>。买方代理可通过其桌面应用或 `antseed buyer start` 启动。代理的本地 HTTP 接口接受非空占位 key；公网认证代理应使用其真实代理 key。

## 安装与首次启用

将目录放在一个长期保留的位置。从其父目录执行：

```sh
magpie plugin add ./antseed-magpie-plugin
magpie plugin login antseed 1
```

首次启用时输入 `antseed-local`。这一步建立 Magpie 要求的 provider 账户，不涉及链上身份私钥。然后运行 `magpie models` 查看 `antseed/<model-id>`。

如果已有自定义 provider 使用 `antseed` ID，Magpie 会将插件 provider 改为 `antseed-plugin`。此时按插件列表显示的实际 ID 登录并选择模型。

## 与已有低价模型共存

在 Magpie 界面中建立路由组，将现有渠道和 AntSeed 模型都加入。或按自己的实际 ID 替换以下占位值：

```sh
magpie group add budget \
  models=your-provider/your-model,antseed/model-id \
  routing=order
```

Agent 选择 `group/budget`。上述顺序先使用现有渠道，失效时尝试 AntSeed；交换两个成员即可反过来。默认会话亲和性有利于缓存；若需要每次都严格恢复成员顺序，可设置 `stays=off`，代价是缓存可能更少。

该插件不会自动把新模型插入已有路由组，也不包含跨 provider 动态最低价策略。路由组只需按你的用途配置一次。

## 配置

在 Magpie 的插件 Options 中填写 JSON，或使用 CLI。CLI 中的插件名以 `magpie plugin list` 为准；本地目录安装也可使用完整目录路径。

```sh
magpie plugin options ./antseed-magpie-plugin \
  '{"baseUrl":"http://127.0.0.1:8377","includePinned":false,"models":["your-model-id"]}'
```

| 选项 | 默认 | 含义 |
|---|---|---|
| `baseUrl` | `ANTSEED_BASE_URL` 或 `http://127.0.0.1:8377` | 买方代理根 URL 或 `/v1` URL |
| `models` | 全部文本模型 | 可选的精确模型 ID 允许列表 |
| `includePinned` | `false` | 另显示稳定的 `<peerId>@<serviceId>` 固定卖家路由 |
| `discoveryTimeoutMs` | `4000` | 模型目录请求超时 |

每次 Magpie 调用 `provider.models` hook，插件重新获取目录；这是按调用刷新，不是持续监听。`ANTSEED_BASE_URL` 必须存在于运行 Magpie 的进程环境中；桌面启动时更建议配置 `baseUrl`。

## 行为与边界

- 自动入口为裸模型 ID，交由 AntSeed 买方代理按其价格、信任、健康及会话亲和性策略选择卖家。
- 固定卖家入口使用 AntSeed 原生 `<peerId>@<serviceId>`，信誉和显示名称不会改变其 ID。
- 模型的上下文、输出限制及能力来自 `/v1/models`；未知数值表示为 `0`，不猜测 400K 上下文。
- 每个模型优先使用所有相关卖家共有的文本协议；无共同协议时使用 Chat，由 AntSeed 适配。跨协议转换可能丢失推理信息。
- 单一卖家价格使用其公告值。自动路由有多个卖家时，费用估算采用当前已知报价的保守上界，不冒充实际账单。缺少报价的模型名称显示 `price unknown`；Magpie 对缺省费用字段可能仍显示 0，不能据此判断免费。
- 不改变 HTTP 错误码、响应流或调用方取消信号。已发送内容后的失败不能无缝切换；重试仍受两边网关各自策略约束。
- 不提供卖方功能、图片/decision 服务、充值、私钥管理、余额面板或买方进程自动启动。
- 同一买方代理的余额和支付渠道由多个客户端共享。`buyer.maxPricing` 是每百万 token 的硬单价上限，不是每月总预算。

## 本地验证

```sh
npm test
```

完整源码分析、上游 commit、联调结果及测试替代运行环境说明见交付包中的 `antseed-magpie-analysis.md` 与 `verification/`。测试替代运行环境仅用于本次验证，不用于生产安装。

## 许可证

MIT。该适配器独立实现，仅调用公开的本地 HTTP 接口，不包含 AntSeed SDK 或上游插件源码。
