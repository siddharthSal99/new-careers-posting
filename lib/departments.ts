/** Department names that are probably engineering/research, used to pre-select departments when tracking a company. */
const ENGINEERING = /engineer|software|research|infra|platform|scaling|product|applied|security|data|compute|\bml\b|machine|hardware|developer/i;
const NOT_ENGINEERING = /sales|market|finance|legal|people|recruit|communications|policy|go to market|operations|partnership|workplace|support|product management|product design|\bgov/i;

export function defaultDepartments(names: string[]): string[] {
  return names.filter((n) => ENGINEERING.test(n) && !NOT_ENGINEERING.test(n));
}
