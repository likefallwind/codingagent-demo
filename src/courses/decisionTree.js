/**
 * The decision-tree course.
 *
 * Pure data — no functions — so it is JSON in everything but syntax. A `.js`
 * file only so it can carry comments. This is the whole of what makes the
 * platform teach decision trees; the engine reads it and never knows what
 * subject it is delivering.
 *
 * Two chapters. The main line follows one tree through its life on a fruit
 * dataset (CART: binary cuts, gini). The advanced chapter switches to the
 * play-tennis table and a different algorithm family (ID3 / C4.5: multi-way
 * splits, entropy) to show where impurity scores stop measuring learning. The
 * two chapters run on different lab components and different algorithm code
 * through the same engine.
 *
 * Every number quoted in this text is computed in test/cart.test.js,
 * test/algo.test.js and test/course.test.js against the real data. If the data
 * or the algorithm changes, those tests fail and this prose has to be revised
 * with them — content that claims numbers must be pinned to the numbers.
 */

const MAIN = '主线：一棵树的一生'
const TRAP = '进阶：多值特征的陷阱'

export const decisionTreeCourse = {
  id: 'decision-tree',
  title: '决策树：从分裂到剪枝',
  subtitle: '用水果和打网球的数据，走完一棵树的一生，再看它会在哪里骗你',
  concepts: [
    // ---------------------------------------------------------------- 1
    {
      id: 'read-tree',
      chapter: MAIN,
      practice: { type: 'leaf-route' },
      /** Questions learners actually ask here — offered by the tutor panel. */
      suggestions: [
        '为什么树要问「是 / 否」而不是直接算？',
        '节点里的数字是什么意思？',
        '为什么允许叶子里有错的样本？',
      ],
      title: '读懂一棵树',
      shortTitle: '什么是决策树',
      prerequisites: [],
      objectives: [
        '顺着一棵已建好的树，读出任意一个样本的判定路径',
        '解释为什么叶子里允许混着分错的样本',
      ],
      explain: {
        intuition:
          '决策树就是一串「是 / 否」问题。从最上面的问题开始，每答一次就把样本分成两堆，一直问到你有把握下判断为止。它不算距离、不解方程，只是不停地问问题。',
        example:
          '这棵树先问「果皮是薄的吗」。7 个薄皮的全是苹果，不用再问，直接下结论。剩下 9 个再问重量。注意最右边那个叶子：7 个样本里有 6 个橙子、1 个苹果——树在这里认了，判所有人是橙子，错那 1 个。',
        formal:
          '内部节点是一个判定条件，两条边分别是条件成立与不成立，叶节点给出一个类别预测。叶节点的预测是落进它的样本里的多数类；少数类就是这个叶子的错误。',
      },
      lab: { type: 'tree-reader', config: { tree: 'illustrative', dataset: 'samples' } },
      misconceptions: [
        {
          id: 'leaf_must_be_pure',
          belief: '每个叶子都必须只含一个类别，否则这棵树就是错的',
          cue: '学生认为混着的叶子说明树没建完、建错了，或者要继续往下分',
          correction:
            '把这个叶子继续分下去确实能让训练集上全对，但那一刀往往只是为了照顾这 1 个样本。第 4、5 步会看到这样做的代价：训练误差降到 2.9%，验证误差反而从 10.0% 升到 13.3%。允许叶子里有错，是刻意的选择。',
        },
      ],
      checks: [
        {
          id: 'rt-1',
          kind: 'mcq',
          prompt: '最右边那个叶子里有 6 个橙子、1 个苹果。这棵树对落进这个叶子的水果，会预测成什么？',
          options: [
            { text: '橙子——按多数类判', correct: true },
            { text: '拒绝判断，因为不纯' },
            { text: '各有 6/7 和 1/7 的可能，随机挑一个' },
            { text: '苹果——因为苹果更少见' },
          ],
          explain: '叶节点输出落进它的样本的多数类。这个叶子判橙子，代价是那 1 个苹果被判错。',
        },
        {
          id: 'rt-2',
          kind: 'freeResponse',
          prompt: '为什么这棵树不把那个混着的叶子继续往下分，直到全对为止？',
          rubric:
            '要点：继续分能让训练集全对，但那一刀只服务于极少数样本，学到的是这批数据的偶然性而非规律，会在新数据上变差。提到「过拟合」「泛化」「只为一两个样本」任一即算命中。只说「太麻烦」「树会太大」而没触及泛化，算部分正确。',
          misconceptions: ['leaf_must_be_pure'],
        },
      ],
    },

    // ---------------------------------------------------------------- 2
    {
      id: 'purity',
      chapter: MAIN,
      practice: { type: 'gini-value' },
      /** Questions learners actually ask here — offered by the tutor panel. */
      suggestions: [
        '基尼不纯度和信息熵有什么区别？',
        '连续特征的阈值是怎么枚举的？',
        '增益为 0 意味着什么？',
      ],
      title: '好问题和坏问题，差在纯度',
      shortTitle: '如何选分裂',
      prerequisites: ['read-tree'],
      objectives: [
        '用基尼不纯度量化一堆样本「有多混」',
        '计算一刀的增益，并比较不同特征的优劣',
      ],
      explain: {
        intuition:
          '一刀切得好不好，看切完之后两边比切之前「纯」了多少。全是苹果的一堆最纯，苹果橙子各一半最混。这个「混」的程度就是基尼不纯度。',
        example:
          '16 个样本 8 苹果 8 橙子，基尼 = 0.500，正好是最混的情况。按「果皮 = 薄」切一刀：左边 7 个全苹果（基尼 0），右边 9 个只剩 1 个苹果（基尼 0.198）。加权平均掉到 0.111，增益 0.389——三个特征里最高的。',
        formal:
          'Gini = 1 − p(苹果)² − p(橙子)²。一刀的增益 = 切之前的基尼 − 切之后两边基尼的加权平均，权重是各边的样本数占比。连续特征（重量）的候选阈值取相邻两个观测值的中点——任何落在两个邻居之间的切法，分出来的结果完全一样。',
      },
      lab: { type: 'split-explorer', config: { dataset: 'samples' } },
      misconceptions: [
        {
          id: 'more_thresholds_better',
          belief: '重量能切的位置多，所以重量一定是更好的特征',
          cue: '学生用「候选阈值多 / 取值多」当作特征好的理由',
          correction:
            '候选多只代表搜索空间大，不代表最好的那一刀更好。重量最好的一刀增益 0.227，仍然输给果皮的 0.389。比的是每个特征各自最好的那一刀，不是它有几种切法。',
        },
        {
          id: 'gain_zero_means_useless',
          belief: '增益小的特征就是废的，可以直接扔掉',
          cue: '学生认为果香没用、应该从数据里删掉',
          correction:
            '果香在根节点上增益只有 0.071，确实最弱。但第 1 步那棵树的右支里，正是「无果香」能一刀把剩下的 9 个完全分开——算法真建树时会选它。一个特征在根节点上弱，不等于在深层没用。',
        },
      ],
      checks: [
        {
          id: 'pu-1',
          kind: 'mcq',
          prompt: '16 个样本里 8 苹果 8 橙子，基尼不纯度是多少？',
          options: [
            { text: '0.500', correct: true },
            { text: '1.000' },
            { text: '0.250' },
            { text: '0' },
          ],
          explain: '1 − 0.5² − 0.5² = 0.5。两类各半是二分类里最混的情况，基尼取最大值 0.5。',
        },
        {
          id: 'pu-2',
          kind: 'mcq',
          prompt: '重量有 15 个候选阈值，果皮只有 2 个。这说明什么？',
          options: [
            { text: '什么也说明不了，要比的是各自最好的那一刀', correct: true },
            { text: '重量更好，因为可选的切法更多', misconception: 'more_thresholds_better' },
            { text: '果皮更好，因为更简单' },
            { text: '两者增益一定相等' },
          ],
          explain: '重量最好的一刀增益 0.227，果皮 0.389。候选多少和最终增益没有直接关系。',
        },
        {
          id: 'pu-3',
          kind: 'freeResponse',
          prompt: '「果香」在根节点上的增益只有 0.071，三个特征里最低。那它是不是可以直接从数据里删掉？',
          rubric:
            '要点：不能。特征的价值取决于它作用在哪批样本上；果香在根节点弱，但在果皮切开后的右支里能一刀分净，算法建树时会选它。命中「在子节点里有用」「取决于当前样本」即算正确。只说「以后可能有用」而没说清为什么，算部分正确。',
          misconceptions: ['gain_zero_means_useless'],
        },
      ],
    },

    // ---------------------------------------------------------------- 3
    {
      id: 'greedy',
      chapter: MAIN,
      practice: { type: 'first-cut' },
      /** Questions learners actually ask here — offered by the tutor panel. */
      suggestions: [
        '决策树为什么是贪心算法？',
        '第一刀选错还能救回来吗？',
        '换个顺序会得到同一棵树吗？',
      ],
      title: '亲手建一棵树',
      shortTitle: '贪心建树',
      prerequisites: ['purity'],
      objectives: [
        '自己选出前两刀，并对比算法的选择',
        '说明贪心策略为什么不保证得到全局最优的树',
      ],
      explain: {
        intuition:
          '算法建树的方式很朴素：每一步只看眼前哪一刀增益最大，选完就往下走，从不回头检查上一刀选得对不对。这叫贪心。',
        example:
          '第一刀如果选果皮，左边立刻纯了，只剩 9 个要处理。如果先选果香，两边都还混着，后面的活会更难做——而且没有任何机制会让算法回去改第一刀。',
        formal:
          '每个节点独立地在所有候选分裂里取增益最大者，递归下去，直到纯了、到达深度上限、或没有合法分裂为止。这是局部最优的逐步选择，不搜索所有可能的树，因此不保证全局最优。找全局最优树是 NP-难的。',
      },
      lab: { type: 'tree-builder', config: { dataset: 'samples', maxPicks: 2 } },
      misconceptions: [
        {
          id: 'greedy_is_optimal',
          belief: '每一步都选最好的，最后得到的整棵树就是最好的',
          cue: '学生认为贪心能保证全局最优，或认为不需要考虑第一刀选错的后果',
          correction:
            '局部最优连起来不等于全局最优。第一刀决定了后面所有子问题长什么样，而算法没有回头路。之所以还用贪心，是因为穷举所有树是 NP-难的，贪心在实践中够用且便宜。',
        },
      ],
      checks: [
        {
          id: 'gr-1',
          kind: 'freeResponse',
          prompt: '如果第一刀选错了，后面的分裂能把损失补回来吗？为什么？',
          rubric:
            '要点：不能完全补回来。第一刀决定了两个子问题各自面对哪些样本，后续只能在这个划分内部优化，算法也不会回头修改。命中「不回头」「决定了后续子问题」「只能局部优化」任一即算正确。只答「不能」没有理由，算部分正确。',
          misconceptions: ['greedy_is_optimal'],
        },
        {
          id: 'gr-2',
          kind: 'mcq',
          prompt: '既然贪心不保证最优，为什么实际算法还是用它？',
          options: [
            { text: '穷举所有可能的树是 NP-难的，贪心便宜且效果够用', correct: true },
            { text: '因为贪心其实等价于全局最优，只是证明很难' },
            { text: '因为没人研究过更好的方法' },
            { text: '因为贪心建出的树一定更浅' },
          ],
          explain: '这是一个刻意的工程取舍：放弃最优性保证，换来可接受的计算代价。',
        },
      ],
    },

    // ---------------------------------------------------------------- 4
    {
      id: 'depth-cost',
      chapter: MAIN,
      practice: { type: 'depth-read' },
      /** Questions learners actually ask here — offered by the tutor panel. */
      suggestions: [
        '深度和叶子数是什么关系？',
        '为什么边界都是横平竖直的？',
        '深度不设限会发生什么？',
      ],
      title: '深度的代价',
      shortTitle: '深度与边界',
      prerequisites: ['greedy'],
      objectives: [
        '观察树加深时叶子数和决策边界如何变化',
        '区分「在训练集上更准」和「变得更好」',
      ],
      explain: {
        intuition:
          '树每深一层，叶子数大致翻倍，决策边界就被切得更碎。深到一定程度，边界上会冒出很多细条纹——每一条只为了圈住一两个训练样本。',
        example:
          '在 240 个训练样本上：depth 1 只有 2 个叶子，训练误差 26.3%；depth 5 有 22 个叶子，训练误差 6.3%；depth 8 有 41 个叶子，训练误差 2.9%。训练误差一路在降，看起来一直在变好。',
        formal:
          '决策树的边界总是与坐标轴平行的矩形块，因为每一刀只对单个特征设阈值。加深会单调降低训练误差（每一刀只会让训练集上的不纯度下降），但这不构成模型变好的证据——衡量好坏要看没参与训练的数据。',
      },
      lab: { type: 'depth-explorer', config: { dataset: 'population', depths: [1, 2, 3, 4, 5, 6, 7, 8] } },
      misconceptions: [
        {
          id: 'deeper_is_better',
          belief: '训练误差一直在降，说明树越深模型越好',
          cue: '学生用训练误差的下降作为加深树的理由',
          correction:
            '训练误差单调下降是决策树的数学性质，不是模型质量的证据——它衡量的是「记住了多少」。depth 8 的训练误差 2.9% 比 depth 5 的 6.3% 低，但验证误差反而从 10.0% 涨到 13.3%。',
        },
      ],
      checks: [
        {
          id: 'dc-1',
          kind: 'mcq',
          prompt: '为什么决策树的决策边界永远是横平竖直的？',
          options: [
            { text: '每一刀只对一个特征设阈值，切出来的是与坐标轴平行的面', correct: true },
            { text: '为了画图方便做的简化' },
            { text: '因为用的是基尼而不是熵' },
            { text: '因为特征都被标准化过了' },
          ],
          explain: '想切出一条斜的边界，需要同时用到两个特征的线性组合，标准决策树不做这件事。',
        },
        {
          id: 'dc-2',
          kind: 'prediction',
          prompt: '把深度从 5 拖到 8，训练误差会怎么变？验证误差呢？先预测，再动手验证。',
          rubric:
            '要点：训练误差会继续下降（6.3% → 2.9%），验证误差会上升（10.0% → 13.3%）。两个方向都答对算正确；只答对训练误差方向算部分正确；认为两者都下降，命中 deeper_is_better 这个误解。',
          misconceptions: ['deeper_is_better'],
        },
      ],
    },

    // ---------------------------------------------------------------- 5
    {
      id: 'overfitting',
      chapter: MAIN,
      practice: { type: 'pick-depth' },
      /** Questions learners actually ask here — offered by the tutor panel. */
      suggestions: [
        '为什么训练误差一直在降？',
        '验证集应该留多少？',
        '交叉验证会不会更稳？',
      ],
      title: '过拟合到底发生在哪一层',
      shortTitle: '过拟合曲线',
      prerequisites: ['depth-cost'],
      objectives: [
        '从训练/验证两条误差曲线上读出过拟合的起点',
        '说明为什么只有验证集能告诉你该停在哪里',
      ],
      explain: {
        intuition:
          '把训练误差和验证误差画在同一张图上，两条线会在某个深度分家：训练的那条继续往下，验证的那条开始回头往上。分家的地方就是过拟合的起点。',
        example:
          '验证误差在 depth 5 降到最低的 10.0%，之后升到 13.3% 并不再改善；而训练误差从 6.3% 一路降到 2.9%。多出来的那些深度，只在训练集上有收益。',
        formal:
          '训练误差衡量模型对已见数据的拟合，验证误差估计它对未见数据的表现。两者的差距就是泛化间隙。训练误差对深度单调下降，所以它永远支持你把树建得更深——它在这个问题上不含任何有用信息。',
      },
      lab: { type: 'curve-explorer', config: { dataset: 'population', depths: [1, 2, 3, 4, 5, 6, 7, 8] } },
      misconceptions: [
        {
          id: 'train_error_measures_quality',
          belief: '训练误差低就说明模型好',
          cue: '学生用训练误差挑模型，或认为训练误差和验证误差应该同涨同落',
          correction:
            '训练误差对深度单调下降，是算法的数学性质，因此它对「该停在哪」永远给出同一个答案：再深一点。只有没参与训练的数据能提供独立证据。',
        },
        {
          id: 'curve_must_be_smooth',
          belief: '验证误差曲线应该是一条光滑的 U 形',
          cue: '学生对曲线上的小波动感到困惑，或认为数据/实现有问题',
          correction:
            '验证集只有 60 个样本，判错一个就是 1.67 个百分点，所以曲线天然是抖的。这里 depth 2 的验证误差（16.7%）就比 depth 3（18.3%）低，是个真实的小回落。趋势可信，单点不可信——这也正是交叉验证存在的理由。',
        },
      ],
      checks: [
        {
          id: 'of-1',
          kind: 'mcq',
          prompt: '训练误差随深度单调下降。这件事告诉了我们什么？',
          options: [
            { text: '几乎什么也没告诉我们——它是算法的数学性质，对选深度没有信息量', correct: true },
            { text: '说明模型在稳定变好', misconception: 'train_error_measures_quality' },
            { text: '说明数据质量很高' },
            { text: '说明还应该再加深', misconception: 'train_error_measures_quality' },
          ],
          explain: '一个恒定给出同样答案的指标，无法用来在选项之间做区分。',
        },
        {
          id: 'of-2',
          kind: 'freeResponse',
          prompt: '曲线上 depth 2 的验证误差比 depth 3 还低。这是不是说明 depth 2 比 depth 3 更好？',
          rubric:
            '要点：不能这么下结论。验证集只有 60 个样本，1 个样本就是 1.67 个百分点，单点差异在噪声范围内；应该看整体趋势，或用交叉验证降低方差。命中「样本太少」「噪声」「看趋势」「交叉验证」任一即算正确。只答「是的 depth 2 更好」命中 curve_must_be_smooth 的反面——直接采信单点。',
          misconceptions: ['curve_must_be_smooth'],
        },
      ],
    },

    // ---------------------------------------------------------------- 6
    {
      id: 'pruning',
      chapter: MAIN,
      practice: { type: 'pick-setting' },
      /** Questions learners actually ask here — offered by the tutor panel. */
      suggestions: [
        '预剪枝和后剪枝该用哪个？',
        'min_samples_leaf 怎么定？',
        '随机森林是另一种解法吗？',
      ],
      title: '剪枝：把树修回合适的大小',
      shortTitle: '剪枝与结论',
      prerequisites: ['overfitting'],
      objectives: [
        '用 max_depth 和 min_samples_leaf 控制树的大小',
        '判断一次剪枝是剪对了还是剪过头了',
      ],
      explain: {
        intuition:
          '既然太深会变差，就把树修小。两个旋钮：max_depth 限制层数，min_samples_leaf 规定一个叶子至少要有多少样本——后者专门掐掉那些只为一两个样本存在的叶子。',
        example:
          '在 depth 5 上把 min_samples_leaf 从 1 调到 4：叶子从 22 个减到 20 个，验证误差纹丝不动，都是 10.0%——那 2 个叶子本来就没在干活。但继续调到 6，验证误差就升到 11.7% 了；调到 12，叶子剩 15 个，验证误差恶化到 16.7%。',
        formal:
          '这里用的是预剪枝：在建树时就施加约束。另一种做法是后剪枝，先长满再按代价复杂度自底向上回收。两者都需要一个独立的验证集来判断该停在哪——剪枝本身不提供停止准则。',
      },
      lab: { type: 'prune-explorer', config: { dataset: 'population', quiz: true } },
      misconceptions: [
        {
          id: 'pruning_always_helps',
          belief: '剪枝总是让模型更好，剪得越狠越好',
          cue: '学生把 min_samples_leaf 一路调大，认为叶子越少越好',
          correction:
            '剪枝是在削减模型容量，过头就从过拟合滑到欠拟合。min_samples_leaf 从 1 到 4 验证误差不变（10.0%），到 6 变成 11.7%，到 12 恶化到 16.7%。判断标准仍然只有一个：验证误差。',
        },
      ],
      checks: [
        {
          id: 'pr-1',
          kind: 'mcq',
          prompt: '把 min_samples_leaf 从 1 调到 4，叶子数从 22 减到 20，而验证误差没变。这说明什么？',
          options: [
            { text: '被剪掉的那 2 个叶子本来就没有贡献泛化能力', correct: true },
            { text: '剪枝没起作用，应该换个参数' },
            { text: '验证集太小，测不出差别' },
            { text: '说明还能继续大幅剪下去而不付代价' },
          ],
          explain: '能在不损失验证表现的前提下换来更简单的模型，这正是剪枝要找的位置。',
        },
        {
          id: 'pr-2',
          kind: 'freeResponse',
          prompt: '既然剪枝能提升泛化，为什么不把 min_samples_leaf 调到很大、让树尽可能小？',
          rubric:
            '要点：剪过头会欠拟合——模型容量不足以表达真实规律。实测 min_samples_leaf 到 12 时验证误差从 10.0% 恶化到 16.7%。命中「欠拟合」「容量不足」「验证误差会变差」任一即算正确。只说「树太小不好」没有依据，算部分正确。',
          misconceptions: ['pruning_always_helps'],
        },
      ],
    },

    // ---------------------------------------------------------------- 7
    {
      id: 'instability',
      chapter: MAIN,
      suggestions: [
        '为什么根节点反而最稳？',
        '那到底该相信哪一棵树？',
        '随机森林是怎么利用这一点的？',
      ],
      title: '换一批数据，就换一棵树',
      shortTitle: '树的不稳定',
      prerequisites: ['pruning'],
      objectives: [
        '观察同一个果园的不同批次数据会长出多不一样的树',
        '解释为什么越深的树越不稳定，以及投票为什么能缓解',
      ],
      explain: {
        intuition:
          '前面每一步用的都是同一批 240 个水果。如果果园再摘一批，用同样的算法、同样的设置，长出来的树会一样吗？根节点多半一样，越往下越不一样——决策树对训练数据里的偶然波动非常敏感。',
        example:
          '同一个果园摘了 8 批、每批 240 个水果，各建一棵 depth 8 的树。根节点 8 次都是「果皮 = 薄」，第二刀的阈值在 183 g 到 189 g 之间晃，再往下就各长各的：叶子数从 27 到 42 都有。拿 600 个新水果去问这些树，depth 2 时任意两棵平均只在 1.2% 的水果上意见不同，depth 8 时是 13.0%。',
        formal:
          '这叫高方差：模型随训练数据的偶然波动大幅变化。越深的节点样本越少，一两个样本就能改变哪一刀胜出，而这个改变会传给它下面的整棵子树。降低方差有两条路：剪枝，降低模型容量；或者训练很多棵树再投票——这 8 棵 depth 8 的树投票，验证误差是 10.0%，单棵平均是 12.7%。这正是随机森林的出发点。',
      },
      lab: { type: 'instability-explorer', config: {} },
      misconceptions: [
        {
          id: 'deterministic_means_stable',
          belief: '算法是确定的，所以同一个问题总会得到同一棵树',
          cue: '学生认为换一批数据树的结构不会变，或把「算法确定」理解成「结果稳定」',
          correction:
            '对同一份数据，算法每次都给出同一棵树；但它对数据本身非常敏感。8 批数据里根节点都是「果皮 = 薄」，可 depth 8 的叶子数从 27 到 42 都有，任意两棵平均在 13.0% 的新水果上判得不一样。',
        },
      ],
      checks: [
        {
          id: 'in-1',
          kind: 'mcq',
          prompt: '同一个果园又摘了一批 240 个水果，用完全相同的设置重新建一棵 depth 8 的树。最可能出现什么？',
          options: [
            { text: '根节点那一刀不变，越往下差别越大', correct: true },
            { text: '和原来那棵完全一样——算法是确定的', misconception: 'deterministic_means_stable' },
            { text: '从根节点开始就完全不同' },
            { text: '结构不变，只是叶子里的样本数变了', misconception: 'deterministic_means_stable' },
          ],
          explain: '8 批数据里根节点每次都是「果皮 = 薄」，而 depth 8 的叶子数从 27 到 42 都有。',
        },
        {
          id: 'in-2',
          kind: 'freeResponse',
          prompt: '为什么越深的树，换一批数据之后变化越大？',
          rubric:
            '要点：深处的节点只剩很少的样本，几个样本的偶然波动就能改变哪一刀胜出；上面一刀的改变还会传给下面整棵子树。说出「深处样本少」「偶然波动 / 噪声」「改变会往下传」「方差大」中任一机制即算正确。只说「因为更复杂」「因为过拟合」而没有机制，算部分正确。认为树根本不会变，命中 deterministic_means_stable。',
          misconceptions: ['deterministic_means_stable'],
        },
        {
          id: 'in-3',
          kind: 'mcq',
          prompt: '让 8 棵在不同批次上训练的 depth 8 的树投票，验证误差是 10.0%，而单棵平均是 12.7%。投票为什么更好？',
          options: [
            { text: '各棵树犯的错不完全一样，多数票能把偶然的错误互相抵消', correct: true },
            { text: '投票让每棵树都变浅了' },
            { text: '其中一棵树恰好特别准，投票把它挑了出来' },
            { text: '纯属巧合，换一个验证集就不成立' },
          ],
          explain: '每棵树都在各自那批数据的偶然波动上犯错，这些错误彼此不重合，多数票就把它们冲掉了。这是随机森林的核心想法。',
        },
      ],
    },

    // ---------------------------------------------------------------- 8
    {
      id: 'entropy-gain',
      chapter: TRAP,
      practice: { type: 'entropy-value' },
      title: '另一把尺子：熵与信息增益',
      shortTitle: '熵与信息增益',
      prerequisites: ['purity'],
      objectives: ['用熵衡量一个集合的混乱程度', '用信息增益比较不同特征的分裂能力'],
      suggestions: [
        '熵和基尼不纯度该用哪个？',
        '为什么用 log₂ 而不是自然对数？',
        '信息增益一定是非负的吗？',
      ],
      explain: {
        intuition:
          '主线用的是基尼和二叉切分（CART）。决策树的另一派——ID3——用熵来量「混乱」，而且一个特征有几个取值就开几个分支。熵衡量「你对结果有多不确定」：14 天里 9 天打球、5 天不打，熵是 0.940 bit，接近最混乱。一个好特征能让你在知道它之后，不确定性大幅下降。',
        example:
          '按天气分裂：阴天 4 天全打球（熵 0），晴天 5 天、雨天 5 天各自还混着。加权后剩 0.694，信息增益 0.247，是四个真实特征里最高的。湿度 0.152，风力 0.048，气温只有 0.029。',
        formal:
          'H(S) = −Σ p(c)·log₂p(c)。特征 A 的信息增益 Gain(S,A) = H(S) − Σ (|Sv|/|S|)·H(Sv)。ID3 在每个节点取信息增益最大的特征，对每个取值开一个分支。',
      },
      lab: { type: 'entropy-explorer', config: { dataset: 'play-tennis' } },
      misconceptions: [
        {
          id: 'entropy_is_error',
          belief: '熵就是错误率的另一种说法',
          cue: '学生把熵和分类错误率混为一谈',
          correction:
            '熵衡量分布的不确定性，不是任何分类器的表现。9 打 / 5 不打这个集合熵是 0.940，而「全猜打球」的错误率是 5/14 ≈ 0.357。两者是不同的量，只是都在集合变纯时趋于 0。',
        },
      ],
      checks: [
        {
          id: 'eg-1',
          kind: 'mcq',
          prompt: '一个集合里两个类别各占一半，它的熵是多少？',
          options: [
            { text: '1 bit', correct: true },
            { text: '0.5 bit', misconception: 'entropy_is_error' },
            { text: '0 bit' },
            { text: '2 bit' },
          ],
          explain: '−0.5·log₂0.5 − 0.5·log₂0.5 = 1。二分类下熵的最大值就是 1 bit。0.5 是这时的错误率，也是基尼的最大值，但不是熵。',
        },
        {
          id: 'eg-2',
          kind: 'freeResponse',
          prompt: '「阴天」那 4 天全都打球。这个分支的熵是多少？为什么？',
          rubric:
            '要点：熵为 0，因为集合是纯的——只有一个类别，没有不确定性。命中「0」且给出「纯 / 只有一类 / 没有不确定性」的理由即算正确。只答 0 没有理由算部分正确。',
        },
      ],
    },

    // ---------------------------------------------------------------- 9
    {
      id: 'many-values',
      chapter: TRAP,
      practice: { type: 'id-gain' },
      title: '一列行号能骗过信息增益',
      shortTitle: '多值陷阱',
      prerequisites: ['entropy-gain'],
      objectives: ['解释为什么取值越多的特征信息增益越高', '识别出标识符型特征'],
      suggestions: [
        '为什么分支越多增益越大？',
        '现实数据里哪些列是这种陷阱？',
        '把 Day 删掉是不是就没事了？',
      ],
      explain: {
        intuition:
          '把 Day 这一列（D1 到 D14，每天一个编号）当成特征喂进去。它会把 14 个样本切成 14 个单样本分支，每支都纯。信息增益因此等于整个数据集的熵——0.940，可能达到的最大值。ID3 会毫不犹豫地选它。',
        example:
          '结果是一棵只有一层、14 个叶子的树，训练集上 100% 正确。可第 15 天来了，它找不到 D15 这个分支，只能退回全体的多数——判「打」。而且不管第 15 天是晴是雨、风大风小，它都判「打」：它根本不看天气。相比之下真正有用的天气，增益只有 0.247。',
        formal:
          '信息增益对分支数存在系统性偏好：分得越细，各子集越可能纯，加权熵越低。极限情况下每个样本自成一支，加权熵为 0，增益达到 H(S)。这个偏好与特征的预测价值无关。',
      },
      lab: { type: 'id-trap-explorer', config: { dataset: 'play-tennis' } },
      misconceptions: [
        {
          id: 'more_values_better',
          belief: '取值多的特征信息量更大，所以更好',
          cue: '学生用取值数量或分支数来论证特征质量',
          correction:
            'Day 有 14 个取值、增益 0.940，是所有特征里最高的，但它对预测新的一天毫无价值。增益高只说明它在这批数据上分得干净，不说明它学到了任何规律。',
        },
      ],
      checks: [
        {
          id: 'mv-1',
          kind: 'mcq',
          prompt: 'Day 这一列的信息增益，为什么正好等于数据集的初始熵 0.940？',
          options: [
            { text: '因为它把每个样本单独分成一支，每支都纯，分裂后加权熵为 0', correct: true },
            { text: '因为它和目标变量完全相关', misconception: 'more_values_better' },
            { text: '因为它的取值是有序的' },
            { text: '巧合' },
          ],
          explain: '增益 = 初始熵 − 分裂后加权熵。分裂后加权熵为 0 时，增益就等于初始熵，这是上限。',
        },
        {
          id: 'mv-2',
          kind: 'freeResponse',
          prompt: '用 Day 建出来的树在 14 个训练样本上 100% 正确。为什么它仍然是一棵毫无价值的树？',
          rubric:
            '要点：它只是记住了每一行，对没见过的新样本（新的 Day 编号）无法给出任何有依据的预测，没有学到可泛化的规律。命中「记忆 / 泛化 / 新样本没见过这个编号 / 不看天气」任一即算正确。只说「过拟合」而没解释机制，算部分正确。',
          misconceptions: ['more_values_better'],
        },
      ],
    },

    // ---------------------------------------------------------------- 10
    {
      id: 'gain-ratio-limits',
      chapter: TRAP,
      practice: { type: 'split-info' },
      title: '增益率救不了这一局',
      shortTitle: '增益率的边界',
      prerequisites: ['many-values'],
      objectives: [
        '用增益率对信息增益做归一化',
        '说明为什么增益率在这个数据集上仍然选中 Day，以及什么才挡得住它',
      ],
      suggestions: [
        '那增益率到底有没有用？',
        'C4.5 实际是怎么处理这个问题的？',
        '随机森林会不会也被骗？',
      ],
      explain: {
        intuition:
          '既然问题出在分支太多，就除以一个衡量分支数的量。Split Info 是分支大小分布本身的熵：Day 的 14 个单样本分支，Split Info 是 log₂14 = 3.807，很大。用增益除以它，得到增益率。',
        example:
          '但算完之后：Day 的增益率是 0.2470，天气只有 0.1564。Day 还是赢。教科书上「增益率解决了多值偏好」这句话，在这个数据集上直接不成立。C4.5 的官方启发式——先筛掉增益低于平均的特征，再比增益率——也救不了：Day 的增益太大，把平均值抬到了 0.2832，高过所有真实特征，反而让它成了唯一候选。',
        formal:
          'GainRatio(S,A) = Gain(S,A) / SplitInfo(S,A)，其中 SplitInfo(S,A) = −Σ (|Sv|/|S|)·log₂(|Sv|/|S|)。归一化削弱了标识符的优势，但没有消除它。真正可靠的防御是结构性的：要求每个分支平均至少有 2 个样本，Day（平均 1 个）直接出局，天气以增益率 0.1564 胜出。但门槛也不能乱定——超过 4.67，天气自己也会被挡在门外。',
      },
      lab: { type: 'gain-ratio-explorer', config: { dataset: 'play-tennis' } },
      misconceptions: [
        {
          id: 'gain_ratio_fixes_bias',
          belief: '增益率解决了多值特征偏好的问题',
          cue: '学生认为换成增益率或 C4.5 就不会选中 Day 了',
          correction:
            '在这个数据集上不成立：Day 的增益率 0.2470 仍然高于天气的 0.1564。C4.5 的平均增益筛选同样失效。增益率缩小了差距，但没有翻盘。',
        },
      ],
      checks: [
        {
          id: 'grl-1',
          kind: 'mcq',
          prompt: '按增益率排序，Day（0.2470）和天气（0.1564）谁排前面？',
          options: [
            { text: 'Day 仍然排第一——增益率没能挡住它', correct: true },
            { text: '天气排第一，增益率修正了偏好', misconception: 'gain_ratio_fixes_bias' },
            { text: '两者相等' },
            { text: '增益率对 Day 无法计算' },
          ],
          explain: '这正是这一节的要点：常见的一句话总结在这个数据集上是错的。',
        },
        {
          id: 'grl-2',
          kind: 'freeResponse',
          prompt: '既然增益率和 C4.5 的启发式都挡不住 Day，什么才挡得住？',
          rubric:
            '要点：结构性判断——检测并拒绝那些分支几乎全是单样本的特征（标识符），或在预处理阶段就不把行号这类列当作特征。命中「按分支大小/单例比例判断」「不把标识符当特征」「最小叶子样本数」任一即算正确。只说「人工检查」算部分正确。',
          misconceptions: ['gain_ratio_fixes_bias'],
        },
      ],
    },
  ],

  /** Shown after every concept is mastered. */
  conclusion:
    '验证集是唯一能告诉你「该停在哪里」的东西，训练误差永远支持你把树建得更深。不纯度指标也只回答「这一刀把数据分得多干净」，不回答「这一刀学到了什么」——一列行号能把前一个问题答到满分。',
}
