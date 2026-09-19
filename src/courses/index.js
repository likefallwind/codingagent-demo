/**
 * Course registry. Adding a subject means adding a course document here and a
 * lab component for any widget type it names — no engine change.
 *
 * The two courses below are a deliberate test of that claim: different subject
 * matter, different algorithm family (binary numeric CART vs multi-way
 * categorical ID3), different lab components, identical engine.
 */
import { decisionTreeCourse } from './decisionTree.js'
import { idTrapCourse } from './idTrap.js'

export const courseList = [decisionTreeCourse, idTrapCourse]
export const courses = Object.fromEntries(courseList.map((c) => [c.id, c]))
export const getCourse = (id) => courses[id] ?? null
export const getConcept = (courseId, conceptId) =>
  getCourse(courseId)?.concepts.find((c) => c.id === conceptId) ?? null
