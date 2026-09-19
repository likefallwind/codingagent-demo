# LearnAI

一个自适应学习平台的原型。它与聊天式教学的区别在于三件事：系统维护一个**学习者模型**（知道你哪个概念会、哪里不会、错在哪个具体误解上）、用**确定性规则**决定下一步教什么、并把**可操作的反馈**建立在真实计算之上而非语言模型的判断之上。

当前有两门课，都是真跑通的：

| 课程 | 主题 | 算法 |
|---|---|---|
| 决策树：从分裂到剪枝 | 6 个概念，16 个水果样本 + 300 个合成样本 | CART：二叉阈值分裂、基尼 |
| 多值特征的陷阱 | 3 个概念，14 天打网球数据 | ID3 / C4.5：多路分裂、信息增益、增益率 |

两门课的算法族、数据形态、实验组件完全不同，**共用同一套引擎，引擎代码一行未改**。

## 运行

需要 **Node 18 或更高版本**。首次运行会自动安装依赖，不用先跑 `npm install`。

```bash
git clone git@github.com:likefallwind/codingagent-demo.git
cd codingagent-demo
cp .env.example .env              # 填入 MINIMAX_API_KEY
./start.sh
```

然后打开 **http://localhost:5173**。`Ctrl+C` 停止。

### 四种模式

| 命令 | 作用 |
|---|---|
| `./start.sh` | 开发模式。Vite :5173 + API :8787，改代码自动重载。**日常用这个。** |
| `./start.sh prod` | 生产模式。先构建，再由单个进程在 :8787 托管前后端。 |
| `./start.sh test` | 跑 61 个单元测试。 |
| `./start.sh stop` | 停掉残留进程（比如上次 Ctrl+C 没清干净）。 |

### API key

AI 批改、提示、问答需要 Minimax 的 key。两种设法，二选一：

```bash
# 写进 .env（推荐，已被 .gitignore 忽略）
echo 'MINIMAX_API_KEY=你的key' > .env

# 或临时导出（优先级高于 .env）
export MINIMAX_API_KEY=你的key
```

**不设也能跑。** 网站、六步实验、所有数学计算和对错判定都在本地完成，完全正常；
只有 AI 那三类功能会返回 502，界面上会明确提示而不是静默失败。

### 换端口

```bash
WEB_PORT=3000 PORT=3001 ./start.sh
```

端口被占时脚本会直接报出占用的进程号并退出，不会静默失败。

### 不用脚本

脚本只是包了一层，底下就是普通的 npm 命令：

```bash
npm install
npm run dev                       # Vite :5173 + API :8787
npm run build && npm run server   # 单进程 :8787
npm test
```

## 架构

```
src/engine/          与学科无关，不知道自己在教什么
  schema.js          Course 契约 + 校验器
  learnerModel.js    BKT 贝叶斯知识追踪 + localStorage 持久化
  policy.js          教学决策（纯规则，无 LLM）
  useLearner.js      React 绑定

src/courses/         纯数据，等价于 JSON
  decisionTree.js    决策树课程
  idTrap.js          多值陷阱课程

src/labs/            唯一与学科相关的代码
  registry.js        widget type -> 组件
  fruitTree/         CART 算法 + 数据集 + 6 个实验组件
  decisionTree/      ID3 算法 + 数据集
  playTennis/        ID3 实验组件

start.sh             启动脚本（dev / prod / test / stop）
.env.example         环境变量模板

server/
  minimax.js         Minimax 适配器
  tutor.js           三类 prompt：批改 / 诊断 / 问答
  factcheck.js       数字幻觉拦截
  index.js           Express，藏 API key + SSE 中转
```

加一门新课 = 写一份 course 文档 + 为它引用的 widget type 写组件。引擎不动。

### LLM 用在哪、不用在哪

**用**：批改自由回答、解释已被检测到的错误、回答学习者提问。

**不用**：
- **不判对错。** 实验室的对错由真实算法瞬时判定。模型只解释"为什么"。
- **不选路径。** 教学决策是规则式的——确定性、可解释、零延迟。
- **不自由发挥数字。** 见下。

### 三道防线

**1. 结构化输出不能依赖 schema。** Minimax 会**静默忽略** `response_format: json_schema`——传了 strict schema 照样返回散文。只能用 `json_object` + prompt 描述 + 去围栏 + 校验 + 重试一次。见 `server/minimax.js`。

**2. 误解 id 必须闭集。** 批改时模型只能从课程作者登记的误解列表里选 id，发明的 id 一律拒绝重试。学习者模型按 id 计数、教学策略按 id 路由，一个编造的 id 比没有更糟。

**3. 数字必须可溯源。** 模型被要求"不要编数字"后照编不误——实测它说"训练误差从 3.8% 降到 2.9%"，而真实值是 6.3%。`server/factcheck.js` 机械校验：反馈里出现的每个百分比和小数都必须在给定材料中出现过，否则拒绝重试。

### 内容准确性

课程文案里引用的每个数字都在 `test/` 里对着真实计算钉死。改了数据或算法，测试会红，文案必须跟着改。

两处刻意的设计：

- **第 1 步的树是作者手画的**（`buildFromSpec`）。因为在这份数据上，算法自己长出的两层树是**完美的**——`无果香` 干净隔出那唯一的苹果，没有任何"混着的叶子"可以用来讲"树不必 100% 正确"。手画的树只定**结构**，所有计数和基尼仍是真算的，UI 也明确标注"示例树 · 非算法生成"。

- **增益率并不能解决多值偏好。** 这是第二门课存在的理由。在 play-tennis 上 Day 的增益率 0.2470 仍高于天气的 0.1564，C4.5 的"高于平均增益再比增益率"启发式同样失效（Day 的增益把平均值抬到了所有真实特征之上）。真正管用的是结构性判断：拒绝在分支几乎全为单例的特征上分裂。

### BKT 参数

`transit` 在答错时也施加，因此掌握度存在**下限**。这个下限必须低于"挣扎"阈值，否则 policy 里"连续答错就换角度重讲"的分支永远不会触发。`transit = 0.25` 时下限是 0.408（高于阈值 0.35，该分支是死代码）；现取 0.12，下限 0.212。改这个参数要重新核对两个数字，`test/engine.test.js` 里有对应测试。

## 已知限制

- 学习者状态存 localStorage，无账号、不跨设备。
- AI 反馈延迟 3–8 秒，流式只分少数几个 chunk（推理模型先思考后输出）。UI 按"数学瞬时、AI 异步"设计，不阻塞。
- 布局按 1460px 宽设计，未做移动端适配。
- 课程内容目前手写。用 M3 从大纲自动生成 course 文档的管线尚未实现。
