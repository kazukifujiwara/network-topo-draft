export type {
  Cable,
  Circuit,
  ConfigContext,
  Device,
  DeviceInterface,
  IconKey,
  LogicalEndpoint,
  LogicalLink,
  PhysicalEndpoint,
  Position,
  ProviderNetwork,
  Topology,
} from './model';
export {
  allVrfs,
  deepClone,
  deriveDeviceVrfs,
  findDevice,
  findProviderNetwork,
  iconKey,
  siteOf,
  sitesList,
} from './model';

export { TopoParseError, normalize, parse } from './parse';
export { serialize, toCanonical } from './serialize';
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from './validate';
export { validate } from './validate';

export type { LinkSegment, Point, Rect } from './geometry';
export {
  GRID,
  HEAD_H,
  NODE_H,
  NODE_W,
  VRF_PAL,
  VRF_ROW,
  anchor,
  linkSegment,
  logAnchor,
  nodeHeight,
  snap,
  vrfColor,
  vrfRowIndex,
  vrfRowRect,
  vrfRows,
} from './geometry';

export type { AddResult } from './operations';
export {
  addCable,
  addCircuit,
  addDevice,
  addLogicalLink,
  addProviderNetwork,
  alignCol,
  alignRow,
  autoLayout,
  deleteLink,
  deleteNodes,
  distributeH,
  distributeV,
  needsAutoLayout,
  renameDevice,
  renameProviderNetwork,
  renameSite,
  setLogicalEndpointInterface,
  setLogicalEndpointIp,
  uniqueName,
} from './operations';

export { genMarkdown } from './generators/markdown';
export type { MarkdownOptions } from './generators/markdown';
export { genForAi, schemaLegend } from './generators/forAi';
export { genSchemaDoc, topoJsonSchema } from './generators/schema';
export { genDrawio } from './generators/drawio';
