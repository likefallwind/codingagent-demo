/**
 * Course registry. Adding a subject means adding a course document here and a
 * lab component for any widget type it names — no engine change.
 *
 * The decision-tree course is itself a test of that claim: its two chapters run
 * on different algorithm families (binary numeric CART vs multi-way categorical
 * ID3), different datasets and different lab components, through one engine.
 */
import { decisionTreeCourse } from './decisionTree.js'

export const courseList = [decisionTreeCourse]
export const courses = Object.fromEntries(courseList.map((c) => [c.id, c]))
export const getCourse = (id) => courses[id] ?? null
export const getConcept = (courseId, conceptId) =>
  getCourse(courseId)?.concepts.find((c) => c.id === conceptId) ?? null
