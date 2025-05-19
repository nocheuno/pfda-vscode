export class PfdaExecutionNode {
  constructor(
    readonly id: string | number,
    readonly label: string,
    readonly description: string,
    readonly status: string,
    readonly startedAt: string,
    readonly spaceId: string,
    readonly uid: string,
    readonly dxid = '',
    readonly appTitle = 'Unknown',
    readonly instanceType = 'Unknown',
    readonly launchedBy = 'Unknown',
    readonly energyConsumption = 'Unknown',
    readonly openExternal?: boolean
  ) {}
}