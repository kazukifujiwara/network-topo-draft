export type {
  Cable,
  Circuit,
  ConfigContext,
  Device,
  DeviceInterface,
  FhrpConfig,
  IconKey,
  LogicalEndpoint,
  LogicalLink,
  Network,
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
  findNetwork,
  findProviderNetwork,
  iconKey,
  siteOf,
  sitesList,
} from './model';

export { TopoParseError, normalize, parse } from './parse';
export type { UnknownFieldFinding } from './unknownFields';
export { findUnknownFields, suggestField } from './unknownFields';
export { ipv4InCidr, parseIpv4 } from './cidr';
export { serialize, toCanonical } from './serialize';
export type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from './validate';
export { validate } from './validate';

export type { LinkSegment, Point, Rect } from './geometry';
export {
  GRID,
  HEAD_H,
  NODE_H,
  NODE_W,
  SEGMENT_RX,
  VRF_PAL,
  VRF_ROW,
  anchor,
  linkSegment,
  logAnchor,
  nodeHeight,
  roundedAnchor,
  snap,
  vrfColor,
  vrfRowIndex,
  vrfRowRect,
  vrfRows,
} from './geometry';

export type { AddResult, PasteResult, TopoClipboard } from './operations';
export {
  addCable,
  addCircuit,
  addDevice,
  addLogicalLink,
  addNetwork,
  addProviderNetwork,
  alignCol,
  alignRow,
  autoLayout,
  convertCableToCircuit,
  convertCircuitToCable,
  deleteLink,
  deleteNodes,
  distributeH,
  distributeV,
  makeClipboard,
  needsAutoLayout,
  pasteClipboard,
  renameDevice,
  renameNetwork,
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
