import { Camera, FileText, Home, Package, PackageSearch, Search, Store, type LucideIcon } from 'lucide-react';

/** Maps the DB's `icon` slug (a lucide-react kebab-case name) to its component. */
const ICONS: Record<string, LucideIcon> = {
  'package-search': PackageSearch,
  store: Store,
  home: Home,
  'file-text': FileText,
  camera: Camera,
  search: Search,
};

export function categoryIcon(icon: string): LucideIcon {
  return ICONS[icon] ?? Package;
}
