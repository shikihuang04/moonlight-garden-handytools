# moonlight-garden-handytools

月光花园游戏地址：https://moonlightgarden.space/

一组独立、非官方的月光花园 MCP 小工具。它通过用户自己的月光花园 MCP 连接工作，不负责创建账号或提供连接凭据。

本项目仅用于减少 Agent 执行花园日常时的工具调用次数，并聚合、精简返回数据；工具不会自行运行，也不代替 Agent 或用户作出游戏决策。

三个工具可以分别启用：

- `daily_routine`：把打零工 3 次、购买 10 个小面包虫、钓鱼 10 次合并为一次手动调用；菜谱功能开启时，还会读取最新 50 道菜、选出售价最高的 5 道并更新本地贵菜账。它保留每一步的原始结果，并用 UTC 日期和本地状态避免同一天误调用时重复执行。
- `farm_brief`：只读汇总可耕地与作物成熟时间、浇水冷却、鸡舍与鸡蛋、白菜缺口，以及蜂箱、采蜜出行和门口幼蜂状态；不会执行任何花园或蜜蜂动作。
- `recipe_check`：读取本地贵菜账、实时背包和今日剩余做菜次数，找出材料齐全或只缺一种材料的菜，并按单次增值排序；贵菜账没有可做菜时才检查最新 50 道作为兜底。它只验证和排序，不会自动做菜或卖菜。

## 可选的快速积累 Moon 方案（默认开启，可选关闭）

这套工具内置了一条简单的菜谱工作流，适合希望更快积累 Moon 的玩家（快速积累 Moon 会加速消耗游戏内容，请用户与 Agent 充分讨论后再决定是否保留）：

1. 每天手动调用 `daily_routine` 后，工具会自动读取最新 50 道菜谱，从中选出售价最高的 5 道，并按上游提供的权威 `dishItemId` 去重更新到本地贵菜账。
2. 做菜前调用 `recipe_check`，工具会把贵菜账与实时背包、今日剩余做菜次数进行匹配，列出当前材料齐全的菜，并按单次增值排序。
3. 尽量优先制作 `recipe_check` 排在前面的高增值菜，有助于更快积累 Moon。这里比较的是成品售价减去原料直接出售价值后的增值，不是只看成品售价。

> `daily_routine` 没有定时器，也不会在每天某个时间自动运行；只有用户或 Agent 主动调用时，上述菜谱读取和记录才会执行。

如果不需要这套菜谱方案，请把 `recipeLedger.enabledInDailyRoutine` 设为 `false`，并从 `enabledTools` 中移除 `recipe_check`。这样 `daily_routine` 仍可继续执行打零工、买虫和钓鱼，`farm_brief` 也不受影响。

## 关键可配置项

以下几项都可以直接在配置文件中修改：

| 需求 | 配置项 | 作用 |
| --- | --- | --- |
| 开关菜谱拉取与贵菜账记录 | `recipeLedger.enabledInDailyRoutine` | 一个总开关；开启时两项一起运行，关闭时两项一起停用 |
| 修改贵菜账保存目录 | `recipeLedger.directory` | 可填写本机绝对路径；设为 `null` 时使用当前系统的默认应用数据目录 |
| 修改贵菜账文件名 | `recipeLedger.fileName` | 可自行命名，但只能填写文件名，不能在这里夹带目录路径 |
| 修改白菜缺口公式 | `farmBrief.cabbagePlantGapFormula` | 可用鸡数量和背包白菜数量组合出适合自己的计算规则 |

`recipe_check` 依赖本地贵菜账。若账本不存在或格式错误，它会明确返回账本读取错误，不会假装“当前没有能做的菜”。

## 要求与安装

- Node.js 20 或更新版本
- 可用的月光花园 Streamable HTTP MCP 地址

```bash
git clone https://github.com/shikihuang04/moonlight-garden-handytools.git
cd moonlight-garden-handytools
npm ci
npm run build
cp config.example.json moonlight-garden-handytools.config.json
```

连接信息只从环境变量读取：

- `MOONLIGHT_GARDEN_MCP_URL`：必填，月光花园 MCP 地址。公网地址必须使用 HTTPS。
- `MOONLIGHT_GARDEN_MCP_TOKEN`：可选。如果你的连接使用 Bearer token，在这里提供。

项目不会把连接地址或 token 写进贵菜账、幂等记录或日志。

## MCP 客户端配置

以下是通用 stdio 配置形状；把路径替换为你的绝对路径：

```json
{
  "mcpServers": {
    "moonlight-garden-handytools": {
      "command": "node",
      "args": [
        "/absolute/path/moonlight-garden-handytools/dist/index.js",
        "--config",
        "/absolute/path/moonlight-garden-handytools/moonlight-garden-handytools.config.json"
      ],
      "env": {
        "MOONLIGHT_GARDEN_MCP_URL": "https://your-moonlight-garden-mcp.example/mcp",
        "MOONLIGHT_GARDEN_MCP_TOKEN": "your-token-if-required"
      }
    }
  }
}
```

不同客户端的外层配置键可能不同，但启动命令、参数和环境变量相同。

如果你的连接不需要 Bearer token，请把整个 `MOONLIGHT_GARDEN_MCP_TOKEN` 条目删除，不要填写示例文字。保存后重载或重启 MCP 客户端。

## 配置

```json
{
  "profileId": "default",
  "enabledTools": ["daily_routine", "farm_brief", "recipe_check"],
  "recipeLedger": {
    "enabledInDailyRoutine": true,
    "directory": null,
    "fileName": "moonlight-garden-expensive-recipes.md"
  },
  "farmBrief": {
    "cabbagePlantGapFormula": "chickenCount * 2 - cabbageInInventory"
  }
}
```

`enabledTools` 决定 MCP 对外注册哪些工具。可以只保留一个或两个；不需要三个一起接入。

`profileId` 是用户自行填写的本地账号标签，不是月光花园真实用户 ID，也不会从 token 自动推导。允许英文字母、数字、点、下划线和连字符。每个花园账号必须使用不同的 `profileId`；更换连接凭据时也要同步检查它，否则不同账号会误用同一份每日状态与贵菜账。

`recipeLedger.enabledInDailyRoutine` 是一个总开关：

- `true`：`daily_routine` 同时执行“读取最新 50 道并取售价前 5”和“更新贵菜账”。
- `false`：两步一起关闭；打零工、买虫和钓鱼照常工作。

这个开关不禁用 `recipe_check`。`recipe_check` 本身依赖贵菜账；账本不存在或格式错误时会返回明确的 `errors.ledger`，不会拿空列表冒充“没有能做的菜”。

`recipeLedger.directory` 是所有 profile 的存储根目录。自定义值必须是绝对路径；不会展开 `~`，相对路径会被拒绝。值为 `null` 时使用平台默认根目录：

- macOS：`~/Library/Application Support/moonlight-garden-handytools`
- Windows：`%LOCALAPPDATA%/moonlight-garden-handytools`
- Linux：`$XDG_DATA_HOME/moonlight-garden-handytools`，未设置时为 `~/.local/share/moonlight-garden-handytools`

实际运行文件放在 `<存储根目录>/profiles/<profileId>/`：

```text
profiles/default/
├── daily-routine-state.json
├── daily-routine-state.json.lock
├── moonlight-garden-expensive-recipes.md
└── moonlight-garden-expensive-recipes.md.bak
```

锁文件只在 `daily_routine` 执行期间存在，账本备份只在覆盖已有账本后出现。目录和账本文件名都可以在配置中修改；文件名必须是普通文件名，不能包含目录路径。

`cabbagePlantGapFormula` 可使用数字、`chickenCount`、`cabbageInInventory`、括号和 `+ - * /`。它由受限解析器计算，不执行 JavaScript。默认公式为：

```text
chickenCount * 2 - cabbageInInventory
```

## 时间约定

所有绝对时间均为 UTC ISO 8601，例如 `2026-09-11T04:05:06.789Z`。剩余秒数仍是相对时长，不受时区影响。需要本地提醒时，由调用方把 UTC 转成用户所在时区。

`daily_routine` 的幂等日期也按 UTC 00:00 切换。这是本工具自己的防误调用边界，不声称等同于月光花园服务器的地区自然日。

本项目没有定时器、heartbeat 或后台自动执行入口。只有 MCP 客户端调用 `daily_routine` 时，它才会运行；是谁或什么流程促使 Agent 发起调用，不属于工具限制。

## 首次接入与安全验收

构建并保存 MCP 配置后：

1. 重载 MCP 客户端，确认工具列表中只出现 `enabledTools` 选择的工具。
2. 如果启用了 `farm_brief`，第一次可先调用它，例如对 Agent 说：“调用 `farm_brief` 查看当前农场摘要，不执行任何花园动作。”成功结果应含以 `Z` 结尾的 UTC `checkedAt`；`plots` 不含房屋地块。某个来源失败时应出现对应 `errors`，而不是伪造空状态。
3. 如果没有启用 `farm_brief`，确认工具列表正确即可；不必为了验收而临时启用或调用其他工具。

### 单独启用 `recipe_check` 时初始化账本

仓库内的 [recipe-ledger.example.md](recipe-ledger.example.md) 是空白账本模板。先在配置对应的 `<存储根目录>/profiles/<profileId>/` 创建目录，再把模板复制为 `recipeLedger.fileName` 指定的文件名。

账本最小内容如下：

````markdown
# Moonlight Garden expensive recipes

```json
[]
```
````

空账本是有效账本：`recipe_check` 会因账本内没有可做候选而查询最新 50 道菜，并以 `usedLatest50Fallback: true` 返回兜底候选。但 `recipe_check` 永远不会写入贵菜账，因此单独使用它不会逐日积累菜谱；若要积累，请启用 `daily_routine` 的菜谱查询与写账功能，或自行维护该文件。

不要仅仅为了创建账本而调用 `daily_routine`：它会先真实执行打零工、买 10 个小面包虫和钓鱼 10 次。只有确实想执行整套日常时，才让它顺便建立或更新账本。

## `daily_routine`

按顺序执行：

1. `garden_work` 三次
2. `fish({ command: "buy bread 10" })`
3. `fish({ command: "cast 10" })`
4. 总开关开启时读取 `kitchen({ command: "recipes 50" })`，按 `sell_value` 取前 5
5. 总开关开启时按 `dishItemId` 更新本地贵菜账

每一步保留上游原始 `result`；菜谱步骤另带 `topRecipes`。贵菜账只保存：

- `dishItemId`（上游 `item`，也是去重主键）
- `name`
- `ingredientNames`（上游中文材料名原样保留）
- `sellValue`

账本按 `sellValue` 降序，写前备份为 `.bak`，再原子替换。

同一 UTC 日期再次调用时，已成功步骤不会重做。明确的 `work_limit` 或 `casts_remaining=0` 会记为 `completed_by_daily_limit` 并继续后续步骤。上游明确返回的普通错误会返回：

- `status: "partial_failure"`
- `failedStep`
- 此前成功步骤及其原始结果
- 未执行步骤的 `status: "not_run"`

### 网络结果不确定时

打工、购买或钓鱼发出后，如果没有收到权威回包，工具无法判断动作究竟有没有成功。该步骤会保存为 `outcome_unknown`，总状态为 `needs_resolution`；当天后续调用不会自动重试，也不会继续剩余步骤。

Agent 必须先向用户说明两种选择各自的风险，再由用户明确选择一种恢复方式。不能从“允许每天运行”等长期授权推断选择，也不能由 Agent 自行代选：

```json
{ "resolveUnknown": "assume_completed" }
```

将该步骤记为 `completed_by_user`，不重复动作，然后继续后续步骤；如果原动作其实没有完成，这会跳过它。

```json
{ "resolveUnknown": "retry" }
```

明确重试该步骤。原动作可能已经成功，因此这个选项可能造成重复打工、重复购买或重复钓鱼，只有用户接受风险时才能使用。没有 `needs_resolution` 时传入这个参数会报错且不执行日常。

若已取到前 5 但账本写入失败，`update_recipe_ledger` 会单独失败；下次调用只重试写账，不重复之前的花园动作或菜谱查询。

如果某个花园动作已经成功、但紧接着本地幂等状态写入失败，工具会停止并以 `failedStep: "idempotency_state"` 返回内存中已发生的结果。写入前已保存的预执行状态仍会阻止自动重试；修复目录权限或磁盘问题后，下一次调用会要求用户按 `outcome_unknown` 明确处理。

## `farm_brief`

只调用 `farm({ command: "status" })`、`coop({ command: "status" })` 和 `bee({ command: "status" })`，不执行种植、收获、浇水、喂鸡，也不执行 `send / settle / keep / release / buy / expand` 或替用户挑选幼蜂。

输出包括：

- UTC `checkedAt`
- 仅可耕地的 `plots`，排除房屋地块
- 累计口径的 `maturingWithinHours`（1/2/4 小时）
- `waterCooldownSeconds`、UTC `waterAvailableAt`
- `maturesIfWateredPlotIds`：仅当前剩余 1 到 1800 秒的地块
- 鸡舍状态、白菜库存和配置公式算出的 `cabbagePlantGap`
- 独立的 `bees`：蜂箱数量与容量、今日剩余采蜜次数、出行三态、图鉴进度、蜂箱成员和门口待选幼蜂

`maturingWithinHours` 中保存的是地块编号，并采用累计口径：1 小时内成熟的地块也会出现在 2 小时和 4 小时列表。`cabbagePlantGap` 保留公式的原始正负值；默认公式下，正数表示缺少的白菜数量，0 表示刚好，负数表示背包白菜多于当前目标。

蜜蜂 `tripState` 只有 `home / away / ready_to_settle`。`away` 时若 status 提供权威 Unix `back_at`，工具会转换为 UTC `backAt`；上游只提供取整后的中文倒计时时，`backAt` 为 `null`，并通过 `backInText` 原样返回倒计时。`home` 和 `ready_to_settle` 的 `backAt/backInText` 均为 `null`。固定四小时的单次采蜜时长不进入简报，避免被误读为剩余时间。

`hive` 返回 `beeId/index/name/label/colorId/patternId/preferenceId/preferredCrops`；未命名的蜂保留 `name:null`。`waitingYoung` 只返回 status 能确认的 `beeId/label/colorId/patternId/preferenceId/preferredCrops`。父母信息和 `newToCodex` 只存在于 settle 回包，不会由本工具猜测或补造。

任一来源失败时，工具在 `errors` 中写明来源，并省略依赖该来源的字段，不用空数组、`null` 或 0 冒充查询成功。蜜蜂来源失败或出现无法识别的出行状态组合时，返回 `errors.bee` 并整个省略 `bees`，成功取得的农田与鸡舍字段仍保留。

## `recipe_check`

流程：

1. 读取本地贵菜账。
2. 读取厨房剩余额度和实时 `inventory list`。
3. 用背包、农场目录和鱼类收藏中可核对的“名称 ↔ item ID”做材料映射。
4. 有贵菜可做时只处理账本；账本没有任何 `cookableNow` 时才读取最新 50 道兜底，并设 `usedLatest50Fallback: true`。

`cookableNow` 和 `missingOne` 各最多返回前 5，按单次增值降序。未知、重名或重复材料不猜 ID，只计入聚合摘要：

```json
{
  "unresolvedRecipeCount": 31,
  "unresolvedIngredientSummary": [
    { "name": "石涧雉", "recipeCount": 8 }
  ]
}
```

增值公式：

```text
ingredientSellValue = 每种配方材料一份的权威 sell_value 之和
valueAdded = sellValue - ingredientSellValue
```

背包物品使用 `inventory list` 的实时 `sell_value`。农场目录只能补作物的 `sell_value`；种子购买价 `price` 永远不参与计算。缺失材料没有权威售价时返回 `ingredientSellValue: null`、`valueAdded: null` 和 `valueAddedStatus: "missingIngredientSellValueUnavailable"`。

`canCookAnyNow` 只有在厨房额度大于 0 且 `cookableNow` 非空时才为 `true`。工具不自动做菜、卖菜，也不建议种植、钓鱼或打猎方案。

`cookableNow` 只表示实时背包中的材料齐全，不单独代表今天还允许下锅；实际是否现在能做必须看 `canCookAnyNow` 和 `remainingCookCount`。

### 自动领取礼物的回执

月光花园现有 `inventory list` 可能自动领取待领礼物，所以 `recipe_check` 严格来说不是完全只读。如果上游本次返回了 `received_gifts`，结果会额外包含：

```json
{
  "receivedGifts": [
    {
      "fromName": "小机",
      "receivedAt": "2026-09-11T04:05:06.789Z",
      "itemId": "fish_maple_fish",
      "itemName": "枫月鱼",
      "quantity": 1
    }
  ]
}
```

`receivedAt` 是本工具通过 `inventory list` 领取/观测到礼物的 UTC 时间，不是对方发送礼物的时间；上游当前没有提供权威发送时间。没有领取礼物时省略 `receivedGifts`。

## 开发与验证

```bash
npm test
npm run check
npm run build
```

测试使用本地模拟上游，不会执行真实打工、购买、钓鱼、领奖或其他花园动作。

## License

[MIT](LICENSE)。这是独立实现的非官方项目，与月光花园及其运营方无隶属关系。
