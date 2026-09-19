/**
 * The second course, and the reason it exists.
 *
 * Its subject is different (categorical features, multi-way splits, entropy
 * rather than gini) and its lab is a different component, but the engine that
 * delivers it is byte-for-byte the one that delivers the fruit course. That is
 * the claim this course is here to test.
 *
 * The content is also worth teaching on its own: it corrects a statement that
 * appears in most textbook summaries and that language models repeat — that gain
 * ratio solves the many-valued-feature bias. On this dataset it does not, and
 * every figure below is verified in test/algo.test.js.
 */

export const idTrapCourse = {
  id: 'id3-trap',
  title: '多值特征的陷阱',
  subtitle: '用 14 天的打网球数据，看信息增益怎么被一列行号骗过去',
  lab: 'playTennis',

  concepts: [
    {
      id: 'entropy-gain',
      title: '熵与信息增益',
      shortTitle: '信息增益',
      prerequisites: [],
      objectives: ['用熵衡量一个集合的混乱程度', '用信息增益比较不同特征的分裂能力'],
      suggestions: [
        '熵和基尼不纯度该用哪个？',
        '为什么用 log₂ 而不是自然对数？',
        '信息增益一定是非负的吗？',
      ],
      explain: {
        intuition:
          '熵衡量「你对结果有多不确定」。14 天里 9 天打球、5 天不打，熵是 0.940 bit——接近最混乱。一个好特征能让你在知道它之后，不确定性大幅下降。',
        example:
          '按天气分裂：阴天 4 天全打球（熵 0），晴天 5 天、雨天 5 天各自还混着。加权后剩 0.694，信息增益 0.247，是四个真实特征里最高的。湿度 0.152，风力 0.048，气温只有 0.029。',
        formal:
          'H(S) = −Σ p(c)·log₂p(c)。特征 A 的信息增益 Gain(S,A) = H(S) − Σ (|Sv|/|S|)·H(Sv)。ID3 在每个节点取信息增益最大的特征，对每个取值开一个分支。',
      },
      lab: { type: 'id3-explorer', config: { dataset: 'play-tennis', trap: false } },
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
            { text: '0.5 bit' },
            { text: '0 bit' },
            { text: '2 bit' },
          ],
          explain: '−0.5·log₂0.5 − 0.5·log₂0.5 = 1。二分类下熵的最大值就是 1 bit。',
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

    {
      id: 'many-values',
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
          '结果是一棵深度 1、宽 14 的树，训练集上 100% 正确，对第 15 天却完全无能为力——它没见过那个编号。相比之下真正有用的天气，增益只有 0.247。',
        formal:
          '信息增益对分支数存在系统性偏好：分得越细，各子集越可能纯，加权熵越低。极限情况下每个样本自成一支，加权熵为 0，增益达到 H(S)。这个偏好与特征的预测价值无关。',
      },
      lab: { type: 'id3-explorer', config: { dataset: 'play-tennis', trap: true } },
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
            { text: '因为它和目标变量完全相关' },
            { text: '因为它的取值是有序的' },
            { text: '巧合' },
          ],
          explain: '增益 = 初始熵 − 分裂后加权熵。分裂后加权熵为 0 时，增益就等于初始熵，这是上限。',
          misconceptions: ['more_values_better'],
        },
        {
          id: 'mv-2',
          kind: 'freeResponse',
          prompt: '用 Day 建出来的树在 14 个训练样本上 100% 正确。为什么它仍然是一棵毫无价值的树？',
          rubric:
            '要点：它只是记住了每一行，对没见过的新样本（新的 Day 编号）无法给出任何有依据的预测，没有学到可泛化的规律。命中「记忆 / 泛化 / 新样本没见过这个编号」任一即算正确。只说「过拟合」而没解释机制，算部分正确。',
          misconceptions: ['more_values_better'],
        },
      ],
    },

    {
      id: 'gain-ratio-limits',
      title: '增益率救不了这一局',
      shortTitle: '增益率的边界',
      prerequisites: ['many-values'],
      objectives: [
        '用增益率对信息增益做归一化',
        '说明为什么增益率在这个数据集上仍然选中 Day',
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
          '但算完之后：Day 的增益率是 0.2470，天气只有 0.1564。Day 还是赢。教科书上「增益率解决了多值偏好」这句话，在这个数据集上直接不成立。C4.5 的官方启发式——先筛掉增益低于平均的特征，再比增益率——也救不了：Day 的增益太大，把平均值抬到了所有真实特征之上，反而成了唯一候选。',
        formal:
          'GainRatio(S,A) = Gain(S,A) / SplitInfo(S,A)，其中 SplitInfo(S,A) = −Σ (|Sv|/|S|)·log₂(|Sv|/|S|)。归一化削弱了标识符的优势，但没有消除它。真正可靠的防御是结构性的：拒绝在分支几乎全为单例的特征上分裂。',
      },
      lab: { type: 'id3-explorer', config: { dataset: 'play-tennis', trap: true, criterion: 'gainRatio' } },
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
          id: 'gr-1',
          kind: 'mcq',
          prompt: '按增益率排序，Day（0.2470）和天气（0.1564）谁排前面？',
          options: [
            { text: 'Day 仍然排第一——增益率没能挡住它', correct: true },
            { text: '天气排第一，增益率修正了偏好' },
            { text: '两者相等' },
            { text: '增益率对 Day 无法计算' },
          ],
          explain: '这正是这一节的要点：常见的一句话总结在这个数据集上是错的。',
          misconceptions: ['gain_ratio_fixes_bias'],
        },
        {
          id: 'gr-2',
          kind: 'freeResponse',
          prompt: '既然增益率和 C4.5 的启发式都挡不住 Day，什么才挡得住？',
          rubric:
            '要点：结构性判断——检测并拒绝那些分支几乎全是单样本的特征（标识符），或在预处理阶段就不把行号这类列当作特征。命中「按分支大小/单例比例判断」「不把标识符当特征」「最小叶子样本数」任一即算正确。只说「人工检查」算部分正确。',
          misconceptions: ['gain_ratio_fixes_bias'],
        },
      ],
    },
  ],

  conclusion:
    '不纯度指标只回答「这一刀把数据分得多干净」，不回答「这一刀学到了什么」。一列行号能把前一个问题答到满分。判断特征是否在学习规律，需要看分裂的结构，而不只是分数。',
}
