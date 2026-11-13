import { STAGE, type JobStage } from '@/src/jobs/jobs';
import { Badge, type Tone } from '../ui';

const TONE: Record<JobStage, Tone> = { requested: 'info', audited: 'info', drafting: 'info', quoted: 'gray', serviced: 'warn', to_invoice: 'warn', follow_up: 'bad', verifying: 'gray', ready: 'ok', closed: 'gray' };
export const StageBadge = ({ stage }: { stage: JobStage }) => <Badge tone={TONE[stage]}>{STAGE[stage].label}</Badge>;
