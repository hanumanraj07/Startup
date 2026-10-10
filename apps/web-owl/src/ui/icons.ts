import {
  Ban,
  Bell,
  Camera,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  FileCheck2,
  FileText,
  Flag,
  Hash,
  House,
  Image,
  Inbox,
  LocateFixed,
  MapPin,
  Navigation,
  Package,
  PackageCheck,
  PackageSearch,
  Plus,
  ScanSearch,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Store,
  Trash2,
  TriangleAlert,
  Video,
  Wallet,
  X,
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
  'alert-triangle': TriangleAlert,
  ban: Ban,
  bell: Bell,
  camera: Camera,
  check: Check,
  circle: Circle,
  'circle-check': CircleCheck,
  'circle-dashed': CircleDashed,
  'circle-x': CircleX,
  clock: Clock,
  'file-check': FileCheck2,
  'file-text': FileText,
  flag: Flag,
  hash: Hash,
  home: House,
  image: Image,
  inbox: Inbox,
  'locate-fixed': LocateFixed,
  'map-pin': MapPin,
  navigation: Navigation,
  package: Package,
  'package-check': PackageCheck,
  'package-search': PackageSearch,
  plus: Plus,
  'scan-search': ScanSearch,
  search: Search,
  send: Send,
  'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck,
  store: Store,
  trash: Trash2,
  video: Video,
  wallet: Wallet,
  x: X,
};

/**
 * The drawable shapes of an icon. A lucide icon is `[tag, attrs, children]`:
 * the outer element is the <svg> itself, and the children are the paths and
 * circles to draw inside it.
 */
export function iconShapes(name: string): readonly IconNodeChild[] {
  return (ICONS[name] ?? Package)[2] ?? [];
}
