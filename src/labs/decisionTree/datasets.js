/**
 * Teaching datasets. Small on purpose: a learner has to be able to hold the whole
 * table in their head and check the arithmetic by hand.
 */

/**
 * Quinlan's play-tennis set — the canonical ID3 example.
 *
 * `Day` is deliberately included as a candidate feature. It is a perfect
 * identifier: splitting on it drives entropy to zero and so scores the maximum
 * possible information gain, while being completely useless for prediction. It is
 * the built-in trap for the "pick the feature with the most values" misconception,
 * and the reason gain ratio exists.
 */
export const playTennis = {
  id: 'play-tennis',
  name: '打网球',
  target: 'PlayTennis',
  targetLabel: '是否打球',
  features: ['Outlook', 'Temperature', 'Humidity', 'Wind'],
  trapFeatures: ['Day'],
  labels: {
    Day: '日期',
    Outlook: '天气',
    Temperature: '气温',
    Humidity: '湿度',
    Wind: '风力',
    PlayTennis: '是否打球',
  },
  valueLabels: {
    Sunny: '晴', Overcast: '阴', Rain: '雨',
    Hot: '热', Mild: '温', Cool: '凉',
    High: '高', Normal: '正常',
    Weak: '弱', Strong: '强',
    Yes: '打', No: '不打',
  },
  rows: [
    { Day: 'D1', Outlook: 'Sunny', Temperature: 'Hot', Humidity: 'High', Wind: 'Weak', PlayTennis: 'No' },
    { Day: 'D2', Outlook: 'Sunny', Temperature: 'Hot', Humidity: 'High', Wind: 'Strong', PlayTennis: 'No' },
    { Day: 'D3', Outlook: 'Overcast', Temperature: 'Hot', Humidity: 'High', Wind: 'Weak', PlayTennis: 'Yes' },
    { Day: 'D4', Outlook: 'Rain', Temperature: 'Mild', Humidity: 'High', Wind: 'Weak', PlayTennis: 'Yes' },
    { Day: 'D5', Outlook: 'Rain', Temperature: 'Cool', Humidity: 'Normal', Wind: 'Weak', PlayTennis: 'Yes' },
    { Day: 'D6', Outlook: 'Rain', Temperature: 'Cool', Humidity: 'Normal', Wind: 'Strong', PlayTennis: 'No' },
    { Day: 'D7', Outlook: 'Overcast', Temperature: 'Cool', Humidity: 'Normal', Wind: 'Strong', PlayTennis: 'Yes' },
    { Day: 'D8', Outlook: 'Sunny', Temperature: 'Mild', Humidity: 'High', Wind: 'Weak', PlayTennis: 'No' },
    { Day: 'D9', Outlook: 'Sunny', Temperature: 'Cool', Humidity: 'Normal', Wind: 'Weak', PlayTennis: 'Yes' },
    { Day: 'D10', Outlook: 'Rain', Temperature: 'Mild', Humidity: 'Normal', Wind: 'Weak', PlayTennis: 'Yes' },
    { Day: 'D11', Outlook: 'Sunny', Temperature: 'Mild', Humidity: 'Normal', Wind: 'Strong', PlayTennis: 'Yes' },
    { Day: 'D12', Outlook: 'Overcast', Temperature: 'Mild', Humidity: 'High', Wind: 'Strong', PlayTennis: 'Yes' },
    { Day: 'D13', Outlook: 'Overcast', Temperature: 'Hot', Humidity: 'Normal', Wind: 'Weak', PlayTennis: 'Yes' },
    { Day: 'D14', Outlook: 'Rain', Temperature: 'Mild', Humidity: 'High', Wind: 'Strong', PlayTennis: 'No' },
  ],
}

/**
 * A tiny loan-approval set. Second dataset so the lab is not hard-wired to one
 * table, and so "does this generalise" can be answered by switching datasets.
 */
export const loanApproval = {
  id: 'loan',
  name: '贷款审批',
  target: 'Approved',
  targetLabel: '是否批准',
  features: ['Income', 'Credit', 'Employed'],
  trapFeatures: [],
  labels: { Income: '收入', Credit: '信用', Employed: '在职', Approved: '是否批准' },
  valueLabels: {
    High: '高', Medium: '中', Low: '低',
    Good: '良', Fair: '中', Bad: '差',
    Yes: '是', No: '否',
  },
  rows: [
    { Income: 'High', Credit: 'Good', Employed: 'Yes', Approved: 'Yes' },
    { Income: 'High', Credit: 'Bad', Employed: 'Yes', Approved: 'No' },
    { Income: 'Medium', Credit: 'Good', Employed: 'Yes', Approved: 'Yes' },
    { Income: 'Medium', Credit: 'Fair', Employed: 'No', Approved: 'No' },
    { Income: 'Low', Credit: 'Good', Employed: 'Yes', Approved: 'No' },
    { Income: 'Low', Credit: 'Bad', Employed: 'No', Approved: 'No' },
    { Income: 'Medium', Credit: 'Good', Employed: 'No', Approved: 'Yes' },
    { Income: 'High', Credit: 'Fair', Employed: 'Yes', Approved: 'Yes' },
  ],
}

export const datasets = { [playTennis.id]: playTennis, [loanApproval.id]: loanApproval }
export const datasetList = [playTennis, loanApproval]

/** Human-readable value, falling back to the raw token. */
export const vLabel = (ds, v) => ds.valueLabels?.[v] ?? v
/** Human-readable feature name, falling back to the raw key. */
export const fLabel = (ds, f) => ds.labels?.[f] ?? f
