/**
 * The same experiment, written the way it would be run for real.
 *
 * The sliders on the page are sklearn's own parameter names, and this panel
 * keeps a DecisionTreeClassifier call in step with them, so the lab reads as a
 * rehearsal of real work rather than a toy. The figures in the trailing comment
 * come from this page's own CART, and the comment says so: sklearn chooses
 * thresholds slightly differently, so its numbers can differ a little.
 */

import React from 'react'

const K = ({ children }) => <span style={{ color: '#c678dd' }}>{children}</span>
const S = ({ children }) => <span style={{ color: '#98c379' }}>{children}</span>
const N = ({ children }) => <span style={{ color: '#e5c07b' }}>{children}</span>
const C = ({ children }) => <span style={{ color: '#7f8ba3' }}>{children}</span>

export default function CodeView({ depth, minLeaf, trErr, vaErr, leaves }) {
  const pct = (v) => `${(v * 100).toFixed(1)}%`
  return (
    <pre className="mono" data-testid="code-view" style={{
      margin: 0, padding: '14px 16px', borderRadius: 10, background: '#1f2533', color: '#dfe5f0',
      fontSize: 12.5, lineHeight: 1.75, overflowX: 'auto',
    }}>
      <C># 300 个水果：240 个训练、60 个验证；特征是重量、果香、果皮厚度</C>{'\n'}
      <K>from</K> sklearn.tree <K>import</K> DecisionTreeClassifier{'\n\n'}
      X = df[[<S>"weight"</S>, <S>"aroma"</S>, <S>"peel"</S>]]{'\n'}
      y = df[<S>"label"</S>]{'\n\n'}
      clf = DecisionTreeClassifier({'\n'}
      {'    '}criterion=<S>"gini"</S>,{'\n'}
      {'    '}max_depth=<N>{depth}</N>,{'\n'}
      {'    '}min_samples_leaf=<N>{minLeaf}</N>,{'\n'}
      {'    '}random_state=<N>0</N>,{'\n'}
      ){'\n'}
      clf.fit(X_train, y_train){'\n'}
      clf.score(X_val, y_val){'\n\n'}
      <C># 本页用同样的设置（自己实现的 CART）算出：</C>{'\n'}
      <C># 叶子 {leaves} 个 ／ 训练误差 {pct(trErr)} ／ 验证误差 {pct(vaErr)}</C>{'\n'}
      <C># sklearn 的阈值取法略有不同，数字可能差一点，趋势一致。</C>
    </pre>
  )
}
