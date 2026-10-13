# moonlight-garden-handytools

版本：`0.2.0`

月光花园游戏地址：[moonlightgarden.space](https://moonlightgarden.space/)

一组独立、非官方的月光花园 MCP 小工具。使用你自己的花园 MCP 连接，不依赖 Cyberboss，也不绑定 Codex、Claude Code 或其他特定 Agent 客户端；本项目不提供账号或连接凭据。

仅用于减少 Agent 进行花园日常操作时的调用步骤，聚合状态、精简返回数据，不代替 Agent 或用户作出游戏决策。工具不会到点自动运行；只有收到调用才执行，不限制是谁或什么流程促使 Agent 发起调用。

四个工具可以分别启用，不必全部接入：

| 工具 | 做什么 | 是否执行游戏动作 |
| --- | --- | --- |
| `daily_routine` | 打零工三次，可选读取最新 50 道菜、取售价前 5 并更新本地贵菜账 | 会打工；**不再买鱼饵或钓鱼** |
| `farm_brief` | 汇总土地、浇水、鸡舍、蜜蜂、伙伴、酒坛、节日、公园和五种鱼饵状态 | 只查询，不调用动作命令；上游 `pet status` 的隐式结算行为未得到确认 |
| `recipe_check` | 匹配贵菜账与实时背包，按单次增值返回可做／缺一种材料的候选 | 不做菜、不卖菜；背包查询可能自动领取待领礼物 |
| `fishing_trip` | 按五种鱼饵各自的杆数，补买缺饵并逐杆钓鱼，保留每一步结果 | **会自动消耗 moon 从商店买鱼饵，并消耗鱼饵和今日钓鱼次数** |

> **钓鱼消费提醒：调用 `fishing_trip` 即执行购买和钓鱼，不是查询或预览。** 工具先扣除已有鱼饵库存，再计算所有缺饵的总费用；余额不足时一笔也不买。余额足够就自动购买，没有内置的二次购买确认。只想查看库存和价格，请用 `farm_brief`。

## 可选的积累 Moon 菜谱方案

工具内置一条菜谱工作流（默认开启；加速积累 Moon 也可能加速消耗游戏内容，请用户与 Agent 讨论后决定是否使用）：

1. 每天调用 `daily_routine` 时，自动读取**当时最新的 50 道菜**，选取售价最高的 5 道，按 `dishItemId` 去重更新到本地贵菜账。
2. 做菜前调用 `recipe_check`，自动匹配贵菜账、实时背包和今日厨房额度，列出当前材料齐全的菜，按单次增值排序。
3. 优先考虑当前能做的高增值菜，有助于积累 Moon。这里比较的是“成品售价－原料直接出售价值”，不只是成品最贵；工具不会决定最终做菜组合或自动下锅。

这不是全历史菜谱排行榜，也不保证收益；日常没有定时器，不会每天自行拉取。只有实际调用，才进行本次查询和写账。

不需要这套方案时，让 Agent 将 `recipeLedger.enabledInDailyRoutine` 改为 `false`，并从 `enabledTools` 移除 `recipe_check`；日常打工、农场简报和独立钓鱼仍可分别使用。

## 重点配置：可自行修改

这些设置都放在同一份 JSON 配置中，无须改代码：

| 需求 | 配置项 | 说明 |
| --- | --- | --- |
| **开关菜谱拉取与贵菜账记录** | `recipeLedger.enabledInDailyRoutine` | 一个总开关：两项一起开、一起关 |
| **修改贵菜账保存路径** | `recipeLedger.directory` | 所有 profile 的存储根目录；绝对路径，或 `null` 使用系统默认目录 |
| **修改贵菜账文件名** | `recipeLedger.fileName` | 普通文件名，不含目录 |
| **修改白菜缺口公式** | `farmBrief.cabbagePlantGapFormula` | 默认 `chickenCount * 2 - cabbageInInventory`；保留正负值 |
| 选择接入哪些工具 | `enabledTools` | 四个工具独立注册；可以只启用一个 |
| 隔离多个花园账号 | `profileId` | 本地账号标签，每个账号应使用不同值 |

`recipe_check` 依赖本地贵菜账；文件不存在或格式错误时返回 `errors.ledger`，不会拼空列表假装“没有能做的菜”。关闭日常写账不会自动禁用 `recipe_check`，请按需要单独移除。

## 安装

要求：Node.js 20 或更新版本，以及可用的月光花园 Streamable HTTP MCP 地址。

### 下载指定 Release

在 [Releases](https://github.com/shikihuang04/moonlight-garden-handytools/releases) 选择需要的版本，下载该版本的 **Source code (zip)** 或 **Source code (tar.gz)**，解压后在项目目录运行：

```sh
npm ci
npm run build
cp config.example.json moonlight-garden-handytools.config.json
```

Source code 是源码包，不是免依赖的单文件程序，需要安装依赖并构建。Windows 可以用文件管理器复制配置样例，或 PowerShell 的 `Copy-Item`。已有配置的升级用户**不要执行最后一步覆盖原配置**。

### 从仓库开发源安装

```sh
git clone https://github.com/shikihuang04/moonlight-garden-handytools.git
cd moonlight-garden-handytools
npm ci
npm run build
cp config.example.json moonlight-garden-handytools.config.json
```

仓库默认分支可能包含未发布开发改动；需要固定版本时优先使用 Release 对应的标签／源码包。

连接信息只从环境变量读取：

- `MOONLIGHT_GARDEN_MCP_URL`：必填，花园 MCP 地址；公网地址必须使用 HTTPS。
- `MOONLIGHT_GARDEN_MCP_TOKEN`：可选，需要 Bearer token 时填写，不需要时省略。

不会把 URL/token 写入贵菜账或每日状态；不要分享真实凭据。

## MCP 客户端配置

通用 stdio 配置如下，路径替换成你的绝对路径。各客户端外层配置可能不同，启动命令、参数和环境变量含义相同。

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

不需要 token 时删除整个 `MOONLIGHT_GARDEN_MCP_TOKEN` 条目，不能保留示例文字。保存后重载 MCP 客户端。

## 配置文件与本地数据

```json
{
  "profileId": "default",
  "enabledTools": ["daily_routine", "farm_brief", "recipe_check", "fishing_trip"],
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

未提供 `enabledTools` 时默认启用四个；启用只意味着工具可被发现，**不会自动执行**。已有配置明确列出三个旧工具时，不会被改写或自动加入 `fishing_trip`，需要使用时自行添加。

`profileId` 是自行填写的本地标签，不是服务器用户 ID，也不从 token 推导。允许英文字母、数字、点、下划线和连字符，最多 64 个字符。切换花园账号时同步切换它，避免误用其他账号的账本或每日状态。

`recipeLedger.enabledInDailyRoutine`：`true` 同时拉菜谱并写账；`false` 两步一起关闭，只保留三次打工。不会影响独立 `fishing_trip` 或 `farm_brief`。

`recipeLedger.directory` 是存储根目录，必须是绝对路径；不展开 `~`，相对路径被拒绝。`null` 使用默认值：

- macOS：`~/Library/Application Support/moonlight-garden-handytools`
- Windows：`%LOCALAPPDATA%/moonlight-garden-handytools`
- Linux：`$XDG_DATA_HOME/moonlight-garden-handytools`；未设置时为 `~/.local/share/moonlight-garden-handytools`

实际数据位于 `<存储根目录>/profiles/<profileId>/`：

```text
profiles/default/
├── daily-routine-state.json
├── daily-routine-state.json.lock
├── fishing-trip.lock
├── moonlight-garden-expensive-recipes.md
└── moonlight-garden-expensive-recipes.md.bak
```

锁文件通常只在对应工具执行时存在；`.bak` 是写账前的备份。钓鱼锁不因时间久自动过期：进程异常退出留下锁时，先确认原进程确实停止，再移除该 profile 的 `fishing-trip.lock`；不要删每日记录来强行重跑。

白菜公式支持数字、`chickenCount`、`cabbageInInventory`、括号和 `+ - * /`，由受限解析器计算，不执行 JavaScript。例如改为 `chickenCount * 3 - cabbageInInventory`。工具只返回数值，不自动补种；0 或负数不代表需要补种，不额外推算将来的喂鸡消耗。

## 时间与手动调用约定

工具生成的绝对时间为 UTC ISO 8601，例如 `2026-09-11T04:05:06.789Z`；剩余秒数不受时区影响。提醒需要本地时间时，由 Agent 按用户时区转换。

游戏日按 **UTC 00:00** 切换，日常幂等记录使用同一边界，不用用户所在地自然日。服务器剩余额度仍以上游实时返回为准。

`checkedAt` 是聚合结果的统一计算基准，不宣称土地、鸡舍等来自完全同时的服务器快照。各来源分次取数，已有相对秒数／中文倒计时可能有取整与查询间隔误差。

`festival.active.ends` 原样保留上游的结束日期／文字，不把它猜成一个 UTC 绝对时刻。

工具没有定时器、heartbeat 或自行醒来执行的入口；收到调用才运行。Agent 自主调用、用户让它调用或其他流程唤醒后调用，均不额外限制。

## `daily_routine`

按顺序执行：

1. `garden_work` 三次。
2. 总开关开启时查询 `kitchen({"command":"recipes 50"})`，按 `sell_value` 取前五。
3. 总开关开启时按 `dishItemId` 更新本地贵菜账。

**本版不买鱼饵、不钓鱼。** 用户或 Agent 已通过其他方式钓鱼、当天钓满，也不会因钓鱼步骤挡住写账。

步骤 ID 为 `garden_work_1 / garden_work_2 / garden_work_3 / recipes_top_5 / update_recipe_ledger`。每个成功步骤保留原始 `result`，菜谱步骤另带 `topRecipes`。贵菜账只保存：

- `dishItemId`：上游 `item`，去重主键，不另造 `recipeId`。
- `name`：上游菜名。
- `ingredientNames`：配方材料字符串原样保存；上游提供 ID 时也不翻译。
- `sellValue`：上游 `sell_value`。

已有 ID 更新，没有才新增；最终按售价降序。写账前备份已有非空账本，再原子替换。

同一 UTC 日再次调用，已完成步骤不会重做；明确 `work_limit`／零剩余打工次数视为工具外已完成，继续菜谱步骤。普通失败返回 `status:"partial_failure"`、`failedStep`、此前结果和后续 `not_run`。取得前五不等于账本更新成功：写入失败会明确标为 `update_recipe_ledger` 失败，下次只重试写账。

### 网络结果不确定时

打工请求已发出但未收到权威结果，保存为 `outcome_unknown`，总状态 `needs_resolution`；后续当天调用不自动重试或继续。

Agent 必须说明风险并由用户明确选择，不能自己代选：

```json
{"resolveUnknown":"assume_completed"}
```

记为用户确认完成，再继续；原动作未完成时会跳过它。

```json
{"resolveUnknown":"retry"}
```

明确重试，原动作已完成时可能重复打工。没有未知步骤时传恢复参数会报错，不执行新日常。

动作成功后本地每日状态写入失败，返回 `failedStep:"idempotency_state"` 并保留内存结果；预执行保存的未知状态防止下次盲目重做。修复磁盘／权限后仍按用户明确选择恢复。

## `fishing_trip`

**动作工具，会自动消耗 moon 购买商店里的缺少鱼饵，再钓鱼。** 工具内不额外询问是否支付；调用前由用户／Agent 确认本次杆数。客户端自己的权限审批仍适用。

五个可选非负整数参数，未填算 0：

| 参数 | 鱼饵 |
| --- | --- |
| `bread` | 小面包虫 |
| `moonworm` | 月光虫 |
| `stardust` | 星纹蚯蚓 |
| `moonhalo` | 月华饵 |
| `fullmoon` | 满月秘饵 |

例如 `{"fullmoon":2,"bread":3}`：先用满月秘饵钓 2 杆，再用小面包虫钓 3 杆。全部为 0（或 `{}`）直接成功返回 `status:"noop"` 和“未购买、未钓鱼。”，不查询、不创建锁、不购买、不钓鱼。

非零调用：

1. 查询今日剩余杆数；总请求超出时返回 `insufficient_casts` 和 `remainingCastCountBefore`，不购买、不钓鱼。
2. 查询实时鱼饵库存、五种商店价格及钱包。
3. 每种先抵扣库存：`quantityToBuy = max(0, requestedCasts - quantityBefore)`。
4. 合计**所有缺饵**费用：`requiredMoon = sum(quantityToBuy * unitPrice)`。总钱不够时返回 `insufficient_moon`，不先买某一种、不先钓几杆。
5. 全部够钱后自动买完所有需要的鱼饵，再逐杆 `cast 1 <key>`。购买和钓鱼均固定顺序：`fullmoon → moonhalo → stardust → moonworm → bread`。

没有每日一次限制，每次调用重新检查额度；同一 profile 的本地锁阻止同时执行两轮。不能阻止其他设备／原始花园工具同时花钱或钓鱼，因此实际动作仍可能被上游拒绝。

结果包括：

- `requestedCasts`、各类已确认 `purchasedBaitCounts`、已确认总花费 `spentMoon`。
- `purchasePlan`（原库存、缺多少、单价、预计费用）和 `requiredMoon`；预计不冒充实际消费。
- `purchases`：每次购买的原始 `result`、实际数量、费用及 `state`。
- `casts`：每杆 `castNumber / baitKey / state / result`，原样保留钓到的鱼、空杆或上游自动卖鱼结果。
- `remainingCastCountBefore` / `moonBalanceBefore` 是**执行前**的次数／余额，不是钓完后还剩多少。

空杆也消耗鱼饵和次数；背包满时上游可能自动卖鱼，本工具不改写这种结果。

### 失败与未知结果

任一购买或某一杆失败，立即停止全部剩余步骤；已完成购买、费用和每杆结果继续返回。`failedStep` 明确 `stage / state / code / error`，动作错误还带 `baitKey`，钓鱼错误带 `castNumber`。

- 明确拒绝：`state:"failed"`。
- 连接超时、断线、购买回包无法确认或钓鱼没有有效回包：`state:"unknown"`，**不自动重试**。
- `remainingSteps:"not_run"`、`notRunPurchaseKeys`、`notRunCastCount` 明确剩余没有执行的购买／杆数；失败或未知的当前一杆单列在 `casts`，不再算进未执行杆数。
- `purchaseTotalsComplete:false` 表示存在未知购买；数量／花费总计只包含已确认部分，**不代表未知购买没花钱**。

不会自动退款、回滚或补钓。钓鱼不持久保存逐杆幂等记录；未知结果后先查看原始 `fish status / log` 核验，再决定下一次调用。不要原样盲目重跑；客户端超时或进程中断也不代表动作没发生。

## `farm_brief`

只查询 `farm / coop / bee / pet / kitchen / festival / park / fish` 的 `status` 以及 `fish shop`，共九个上游调用；对 Agent 聚合成一次返回，不代表服务器只被查询一次。

不执行种植、收获、浇水、喂鸡、蜜蜂 `send / settle / keep / release / buy / expand`、伙伴照料、开坛、公园游戏、买饵或钓鱼；不调用可能自动领奖的 `inventory list`。上游 `pet status` 的隐式过夜结算行为未得到确认，因此不保证该查询完全无副作用。

区块／字段：

| 区块 | 内容 |
| --- | --- |
| `plots` | 仅可耕地：`plotId / cropId / maturesInSeconds`，不包含房屋 |
| `maturingWithinHours` | 累计 1/2/4 小时未来成熟地块 ID；已成熟不进入 |
| 浇水 | `waterCooldownSeconds`、UTC `waterAvailableAt`、`maturesIfWateredPlotIds` |
| 鸡舍／白菜 | `chickens / chickenCount / cabbageInInventory / cabbagePlantGap` |
| `bees` | 数量、容量、今日采蜜次数、出行状态、图鉴、蜂箱和门口幼蜂 |
| `pets` | `count / slotsFree / residents / doorstep` |
| `kitchen` | `jarsFree / jars / brews`，**全部三个坛位，包括空坛编号** |
| `festival` | 当前 `active`，没有节日时为 `null`，不预告／推造日期 |
| `park` | `playsLeftToday` 和持有奖券数 `tickets`（不是今天赚的数量） |
| `fish` | `remainingCastCount / moonBalance / baits`：五种鱼饵的 `key / itemId / name / unitPrice / quantity` |

空地成熟时间 `null`，已熟为 0，生长中为正数；1 小时内成熟也进入 2 和 4 小时列表。`maturesIfWateredPlotIds` 仅列剩余 1—1800 秒、浇水会立刻成熟的地块；不等于现在可浇水，另看冷却。

鸡饥饿时 `eggReadyInSeconds:null`，蛋待收为 0，正在下蛋为正数；使用权威鸡编号。土地 `cropId`（如 `polar_grape`）与背包材料 ID（如 `crop_polar_grape`）不是同一个字符串，不能直接混用。

### 蜜蜂

`tripState`：`home / away / ready_to_settle`。采蜜中有权威 `back_at` 就转 UTC `backAt`；缺少时返回 `backAt:null` 和原始倒计时 `backInText`，不根据中文近似时间伪造精确时刻。在家或等待卸货时两者为 `null`。固定四小时的行程时长不进入简报。

`hive` 返回 `beeId/index/name/label/colorId/patternId/preferenceId/preferredCrops`，未命名保留 `name:null`。`waitingYoung` 仅门口待选幼蜂，返回 status 确认的性状和喜好；不伪造 status 没提供的父母与 `newToCodex`，不执行 settle 来补资料。

### 伙伴、酒坛和功能边界

伙伴 `residents` 含 `petId/name/named/species/kind/looks/rawStage/tendedToday/needsTend/statusText`；`needsTend` 仅表示今天没陪过。门口有 `at_the_door` 优先返回 `doorstep.state:"visitor"`，不会被“今天都陪过了”误盖为空；其余已观察状态包括 `baited / tracks / empty / unknown`，陌生提示保留文字，不猜行动。

空坛仅 `{"jarId":2,"stage":"empty"}`；在酿坛保留 `brewing / ingredients / sealedDaysAgo / scentText`，按已核对气味概括 `waiting / mellow / nearly_sour`，陌生文案为 `unknown`。不预测成熟时刻，不自动开坛，也不依据未经核对的气味文案判定最终成醋状态。

不返回偷菜／摸蛋和帮收快枯萎作物的今日剩余次数：上游查询缺少权威计数，不按每日上限伪造剩余次数。

任一来源失败／解析失败，写入 `errors` 并省略其整个区块或依赖字段，成功区块保留。鱼状态或商店任一失败，统一 `errors.fish` 并省略 `fish`；蜜蜂失败为 `errors.bee`，不是空蜂箱；鸡舍或白菜库存失败不生成白菜缺口。

## `recipe_check`

1. 读取本地贵菜账，失败明确返回 `errors.ledger`。
2. 读取厨房额度和实时背包；必需来源失败时不拼候选空列表。
3. 中文材料名只依靠背包／可核对农场目录／鱼类收藏的权威名称与 ID；上游已给 `crop_* / fish_* / meat_* / produce_* / brew_cooking_* / brew_sour_*` 则原样按 ID 匹配。
4. 支持食材料酒 `brew_cooking_*` 与醋 `brew_sour_*`；普通饮用酒 `brew_full_* / brew_light_*` 不算食材。未知、重名、重复材料不猜，毕方／雪驳等中文肉名缺权威映射时仍为未解析。
5. 贵菜账没有任何材料齐全菜才展开最新 50 道，`usedLatest50Fallback:true`。同 `dishItemId` 最新数据可替换旧数据参与本次检查，不改写账本；候选 `source` 为 `ledger` 或 `latest50Fallback`。

`cookableNow` / `missingOne` 各最多前五，按 `valueAdded` 降序；`missingOne` 严格只缺一种，不把地里作物算库存。未解析仅返回 `unresolvedRecipeCount` 和按材料名聚合的 `unresolvedIngredientSummary`，不塞几十道详情。

```text
ingredientSellValue = 每种配方材料一份的权威 sell_value 之和
valueAdded = sellValue - ingredientSellValue
```

不乘库存数量。背包实时单件卖价优先；农场目录只补 `sell_value`，种子购买价 `price` 永不参与增值。缺失材料没有权威售价时，`ingredientSellValue/valueAdded:null`，`valueAddedStatus:"missingIngredientSellValueUnavailable"`，不能用成品价冒充增值。

`cookableNow` 表示材料齐全，不一定有今日额度；`canCookAnyNow = remainingCookCount > 0 && cookableNow.length > 0`。不会自动做菜、卖菜，也不替 Agent 决定为了材料去种地、钓鱼或打猎。

### 自动领奖回执

`inventory list` 可能自动领取待领礼物，所以严格来说不是完全只读。上游本次返回 `received_gifts` 时额外带：

```json
{
  "receivedGifts": [{
    "fromName": "送礼者",
    "receivedAt": "2026-09-11T04:05:06.789Z",
    "itemId": "crop_cabbage",
    "itemName": "白菜",
    "quantity": 2
  }]
}
```

时间是本次领取／观测 UTC 时间，不是对方发送时间；上游没有提供权威发送时间。未领奖省略回执；回执解析失败明确 `errors.receivedGifts`，不会编造送礼者或时间。

### 单独接入时初始化贵菜账

将 [recipe-ledger.example.md](recipe-ledger.example.md) 复制到配置的 `<存储根目录>/profiles/<profileId>/`，命名为 `recipeLedger.fileName`。空账本最小格式：

````markdown
# Moonlight Garden expensive recipes

```json
[]
```
````

空账本有效，会走最新 50 兜底，但 `recipe_check` 不写账、不逐日积累；积累需启用日常菜谱功能或自行维护账本。不要仅为创建账本试跑日常，它会真实打工。

## Operit：面板接入失败时的终端绕行

**这是一种绕过面板的调用方式，不是修复 Operit 管理页。** [Operit 1.12.2（versionCode 51）反馈](https://github.com/shikihuang04/moonlight-garden-handytools/issues/1)来自 Android / proot Ubuntu、Node.js v20.20.2：管理页仍“验证失败”、工具不在 Agent 可用列表；反馈者自己的终端脚本真实调用过 `farm_brief`，未验证其他工具。没有要求重装 Operit。

本仓库 [scripts/call-tool.mjs](scripts/call-tool.mjs) 连接本地 stdio 服务、调用一次工具、输出结果并关闭，不自动重试、不注册到 Operit 面板。本示例的验证环境为 macOS / Node.js 24、真实 stdio 服务和模拟花园；**本示例及新增钓鱼工具的 Android / Operit 兼容性未得到实测验证**。已有可用绕行脚本／正常 MCP 接入者无需更换。

### 准备凭据和目录

在 Linux 中已完成 `npm ci`、`npm run build` 的项目目录操作，确保同一目录有 `dist/index.js`、`node_modules/`、`scripts/call-tool.mjs`；不要误用 Android 下载目录另一份没有依赖的副本。

不需重装、移动账本或修改其他插件。用本地编辑器创建 `.env`，不要将真实凭据放进聊天或命令历史：

```dotenv
MOONLIGHT_GARDEN_MCP_URL="https://your-moonlight-garden-mcp.example/mcp"
# 不需要 token 时省略下面一行。
MOONLIGHT_GARDEN_MCP_TOKEN="your-token-if-required"
```

```sh
chmod 600 .env
```

`.env` 仅本机保留，不分享／提交。下方 `--env-file` 要求 Node.js **20.6+**；已有正确进程环境变量时可省略，它们优先于 `.env`，切换账号注意旧值。

`--config` 使用原配置、相同 `profileId` 和目录，复用原账本／幂等记录；一直使用默认配置者可省略。不要为绕行建立另一个 profile。

### 查询调用

```sh
# 仅列启用工具，不查询上游。
node --env-file=.env scripts/call-tool.mjs list --config moonlight-garden-handytools.config.json

# 聚合简报，不执行花园动作。
node --env-file=.env scripts/call-tool.mjs farm_brief --config moonlight-garden-handytools.config.json

# 检查菜谱；可能自动领取待领礼物。
node --env-file=.env scripts/call-tool.mjs recipe_check --config moonlight-garden-handytools.config.json
```

`list` 成功只证明本地握手／发现工具成功；简报中实际状态和对应来源无 `errors` 才证明查询成功。已有实测者无需为反馈重复调用。Agent 需具备终端能力及授权；仍是终端命令，不等于面板已修复。

### 动作调用：不要用来测试接入

```sh
# 真实打工，并可能写账；本版不钓鱼。
node --env-file=.env scripts/call-tool.mjs daily_routine --config moonlight-garden-handytools.config.json

# 真实花 moon 补买缺饵，再钓 2 杆满月秘饵、3 杆小面包虫。
node --env-file=.env scripts/call-tool.mjs fishing_trip --config moonlight-garden-handytools.config.json --args '{"fullmoon":2,"bread":3}'
```

只有确实要执行时才用这些命令。未知日常恢复通过 `--args` 传 JSON，仍需用户明确选择，不能为了让命令成功自行添加恢复参数。

标准输出为完整 MCP 结果 JSON；`structuredContent` 是数据，`content` 保留工具文本。`isError:true` 退出码 1；启动／参数／连接错误也非零，错误写标准错误。看 `errors/status/failedStep`，不只看有无 JSON。

最多等待五分钟，不自动重试；超时／断线／中断不表示没有发生动作，按工具未知结果规则核验。`MOONLIGHT_GARDEN_MCP_URL is required.` 只表示启动环境缺必填地址，不能单凭它判定 Operit 的 env 有故障。

`run.sh` 若只启动 `node dist/index.js`，不会完成单次工具调用；不要把它与上面调用脚本混淆，也不要用 `node dist/index.js farm_brief`。不再执行绕行命令即可停用，没有额外后台服务。

## 首次验收

1. 重载客户端，查看 `tools/list`，应只有配置选择的工具。
2. 如启用了简报，可调用 `farm_brief` 查看 UTC `checkedAt`、房屋排除和各来源错误；不做动作。
3. 单独启用钓鱼时可用 `{}` 验证 `noop`，无购买／钓鱼；**不要用正数杆数或日常调用测试连接**。
4. 没启用这些工具时只确认列表即可，不必临时新增工具或真实做动作。

## 版本发布与升级

`0.2.0` 对应标签 `v0.2.0`。每个版本使用独立的标签和 GitHub Release，保留旧标签／Release／附件，不将旧包替换成新内容。用户自行选择下载并升级，不强制自动更新。

### 从 0.1.x 升级

1. 停止旧 MCP 服务／关闭客户端连接，确认没有日常或钓鱼请求仍执行中。
2. 保留／备份现有配置、`.env`、自建 `run.sh`、整个 profile 数据目录；不要删除原版安装目录。
3. 将新 Release 解压到**另一个版本目录**，`npm ci`、`npm run build`。配置可继续指向原文件；如复制到新目录，保留 `profileId`、存储路径、账本文件名和自定义白菜公式，不用示例覆盖。
4. 客户端启动路径改到新目录的 `dist/index.js`，重载后先验收工具列表。需要钓鱼时在原 `enabledTools` 增加 `fishing_trip`。

也可覆盖原目录中的程序文件升级，但**不能覆盖用户配置／凭据／状态**；推荐新目录切换，出问题可改回旧启动路径。Release 源码包不包含用户配置或个人账本，`config.example.json` 是样例。

重要变化：日常不再钓鱼；新钓鱼工具是独立动作入口；旧日常状态按步骤 ID 保留已完成打工／菜谱，废弃买饵／钓鱼条目不再执行或阻挡写账，不推断旧未知钓鱼是否发生。贵菜账字段、profile 隔离、UTC 边界和菜谱总开关保持兼容。

改回旧版本并非恢复游戏动作；旧日常仍会买饵／钓鱼，且新状态已不保存废弃步骤。**不要在同一天用旧日常重复验收或跨版本来回执行**。需要回退时先核验上游状态与备份，不盲目恢复旧记录或重试未知动作。

## 开发与验证

按修改范围选择相关测试，不必每次全仓运行：

```sh
node --import tsx --test test/fishing-trip.test.ts test/daily-routine.test.ts test/farm-brief.test.ts test/recipe-check.test.ts test/server.test.ts test/config.test.ts
npm run check
npm run build
node --import tsx --test test/terminal.test.ts
```

测试使用本地模拟上游和隔离的测试目录，不执行真实打工、购买、钓鱼、领奖或游戏动作。模拟测试通过不代表所有 MCP 客户端均已完成兼容性验证。

## License

[MIT](LICENSE)。独立实现的非官方项目，与月光花园及其运营方无隶属关系。
