import {
  Bell,
  Camera,
  CircleCheck,
  CircleDashed,
  Clock,
  FileText,
  House,
  Inbox,
  MapPin,
  Package,
  PackageSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  type IconNode,
  type IconNodeChild,
} from 'lucide';

/**
 * The icons the app uses, keyed by lucide's kebab-case name. The API's
 * `Category.icon` column holds these same names, so a category's icon
 * resolves straight from its row. Add an icon by importing it and adding a
 * line here; an unknown name falls back to `package`.
 */
export const ICONS: Record<string, IconNode> = {
  bell: Bell,
  camera: Camera,
  'circle-check': CircleCheck,
  'circle-dashed': CircleDashed,
  clock: Clock,
  'file-text': FileText,
  home: House,
  inbox: Inbox,
  'map-pin': MapPin,
  package: Package,
  'package-search': PackageSearch,
  search: Search,
  'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck,
  store: Store,
};

/**
 * The drawable shapes of an icon. A lucide icon is `[tag, attrs, children]`:
 * the outer element is the <svg> itself, and the children are the paths and
 * circles to draw inside it.
 */
export function iconShapes(name: string): readonly IconNodeChild[] {
  return (ICONS[name] ?? Package)[2] ?? [];
}
