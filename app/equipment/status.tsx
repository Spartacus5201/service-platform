import { STATUS_LABEL, type EquipmentModel } from '@/src/equipment/registry';
import { Badge } from '../ui';

export const StatusBadge = ({ m }: { m: Pick<EquipmentModel, 'status' | 'replacedByLabel'> }) =>
  m.status === 'current' ? <Badge tone="ok">current</Badge> : <Badge tone={m.status === 'obsolete' ? 'bad' : 'warn'}>{STATUS_LABEL[m.status].toLowerCase()}{m.replacedByLabel ? ` → ${m.replacedByLabel}` : ''}</Badge>;

