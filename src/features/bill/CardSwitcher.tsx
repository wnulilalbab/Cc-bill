// Card switcher on Bill: the card carousel with each card's total of its selected statement (M-09), plus "+ Add card".
import { CardCarousel, type CardTile } from '../cards/CardCarousel'
import { PATHS } from '../shell/paths'

export type { CardTile }

export function CardSwitcher({ tiles, selectedId, onSelect }: { tiles: readonly CardTile[]; selectedId: string; onSelect(id: string): void }) {
  return <CardCarousel tiles={tiles} selectedId={selectedId} onSelect={onSelect} addHref={PATHS.settings} />
}
