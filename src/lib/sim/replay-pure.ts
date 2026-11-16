// browser-safe replay helpers: no sim state, no node modules. the ui imports these instead of sim internals.
// citizensAt / requirementsAt rebuild rosters from keyframes + deltas, dayPlanOf / dayContextOf give a pip's day
// (real weekends, holidays, worship days), holidaysOf lists a country's holidays for a year.
export { citizensAt, requirementsAt, dayPlanOf, dayContextOf, type DayContext } from './citizens-replay'
export { generationOf } from './generations'
export { yearOfTick, monthOfTick, dateOfTick, eventDate, frameAt, populationAt, frontierAt, lifeExpectancyAt, deathsAt, pyramidAt, childShareAt, tierOf, requirementStatus, ageAt, personAt, neighborsOf, agentOf, FRONTIER_LABELS, frontierLabelAt, DONE_BY_2026 } from './truth'
export { nameFor, groupOf, newNameRegistry, GROUPS, COUNTRY_GROUPS, type NameRegistry, type PersonName, type Parent } from './names'
export { holidaysOf, holidayOn, frameDate, weekendOf, type Holiday } from './calendar'
