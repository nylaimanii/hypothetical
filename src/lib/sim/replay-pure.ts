// browser-safe replay helpers: no sim state, no node modules. the ui imports these instead of sim internals.
// citizensAt / requirementsAt rebuild rosters from keyframes + deltas, dayPlanOf / dayContextOf give a pip's day
// (real weekends, holidays, worship days), holidaysOf lists a country's holidays for a year.
export { citizensAt, requirementsAt, dayPlanOf, dayContextOf, type DayContext } from './citizens-replay'
export { holidaysOf, holidayOn, frameDate, weekendOf, type Holiday } from './calendar'
