import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { GripVertical, Paperclip, StickyNote } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BewertungAnzeige } from '../components/Anzeigen'
import { Seite, SeitenKopf } from '../components/Layout'
import { useToast } from '../components/Toast'
import { Badge, LadeZustand, Select } from '../components/ui'
import { formatRelativ, t } from '../i18n'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { vollerName, type BewerbungKurz, type Phase, type Stelle } from '../lib/typen'

interface BoardAntwort {
  spalten: { phase: Phase; eintraege: BewerbungKurz[] }[]
}

export function BoardPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { darfBearbeiten } = useAuth()

  const [stelle, setStelle] = useState('')
  const [gezogen, setGezogen] = useState<BewerbungKurz | null>(null)

  // Ein kurzer Weg vor dem Anfassen: sonst wird jeder Klick auf eine Karte
  // schon als Ziehen gewertet und der Link öffnet nie.
  const sensoren = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const abfrage = stelle ? `?stelle=${stelle}` : ''
  const { data, isLoading } = useQuery({
    queryKey: ['board', stelle],
    queryFn: () => api.get<BoardAntwort>(`/bewerbungen/board${abfrage}`),
  })

  const { data: stellen } = useQuery({
    queryKey: ['stellen'],
    queryFn: () => api.get<Stelle[]>('/stellen'),
  })

  const verschieben = useMutation({
    mutationFn: ({ id, phase }: { id: string; phase: Phase }) =>
      api.patch(`/bewerbungen/${id}/phase`, { phase }),
    onMutate: async ({ id, phase }) => {
      // Die Karte springt sofort – auf die Antwort des Servers zu warten
      // fühlt sich beim Ziehen wie ein Hänger an.
      await queryClient.cancelQueries({ queryKey: ['board', stelle] })
      const vorher = queryClient.getQueryData<BoardAntwort>(['board', stelle])

      queryClient.setQueryData<BoardAntwort>(['board', stelle], (alt) => {
        if (!alt) return alt
        let karte: BewerbungKurz | undefined
        const ohne = alt.spalten.map((s) => {
          const treffer = s.eintraege.find((e) => e.id === id)
          if (treffer) karte = treffer
          return { ...s, eintraege: s.eintraege.filter((e) => e.id !== id) }
        })
        if (!karte) return alt
        return {
          spalten: ohne.map((s) =>
            s.phase === phase ? { ...s, eintraege: [{ ...karte!, stage: phase }, ...s.eintraege] } : s,
          ),
        }
      })
      return { vorher }
    },
    onError: (err: unknown, _variablen, kontext) => {
      if (kontext?.vorher) queryClient.setQueryData(['board', stelle], kontext.vorher)
      toast.fehler(err instanceof ApiError ? err.message : t('app.fehler'))
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['board'] })
      await queryClient.invalidateQueries({ queryKey: ['uebersicht'] })
    },
  })

  function beimStart(ereignis: DragStartEvent) {
    const id = String(ereignis.active.id)
    setGezogen(data?.spalten.flatMap((s) => s.eintraege).find((e) => e.id === id) ?? null)
  }

  function beimEnde(ereignis: DragEndEvent) {
    setGezogen(null)
    const ueber = ereignis.over?.id
    if (!ueber) return
    const id = String(ereignis.active.id)
    const zielPhase = String(ueber) as Phase

    const aktuell = data?.spalten.find((s) => s.eintraege.some((e) => e.id === id))
    if (aktuell?.phase === zielPhase) return

    verschieben.mutate({ id, phase: zielPhase })
  }

  if (isLoading) return <Seite breit><LadeZustand /></Seite>

  return (
    <Seite breit>
      <SeitenKopf
        titel={t('navigation.board')}
        aktion={
          <Select
            value={stelle}
            onChange={(e) => setStelle(e.target.value)}
            className="w-[16rem]"
            aria-label={t('bewerbungen.stelle')}
          >
            <option value="">{t('bewerbungen.alleStellen')}</option>
            {stellen?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        }
      />

      <DndContext sensors={sensoren} onDragStart={beimStart} onDragEnd={beimEnde}>
        <div className="flex gap-4 overflow-x-auto pb-4 duenner-scroll">
          {data?.spalten.map((spalte) => (
            <Spalte
              key={spalte.phase}
              phase={spalte.phase}
              eintraege={spalte.eintraege}
              ziehbar={darfBearbeiten}
            />
          ))}
        </div>

        <DragOverlay>
          {gezogen && (
            <div className="w-72 rotate-2 opacity-95">
              <KartenInhalt bewerbung={gezogen} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </Seite>
  )
}

function Spalte({
  phase,
  eintraege,
  ziehbar,
}: {
  phase: Phase
  eintraege: BewerbungKurz[]
  ziehbar: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: phase })

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        'flex w-72 shrink-0 flex-col rounded-xl border transition-colors',
        isOver ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-slate-100/60',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-slate-700">{t(`phasen.${phase}`)}</h2>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
          {eintraege.length}
        </span>
      </header>

      <div className="flex min-h-[8rem] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 duenner-scroll">
        {eintraege.map((b) => (
          <Karte key={b.id} bewerbung={b} ziehbar={ziehbar} />
        ))}
        {eintraege.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Keine Bewerbung</p>
        )}
      </div>
    </section>
  )
}

function Karte({ bewerbung, ziehbar }: { bewerbung: BewerbungKurz; ziehbar: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: bewerbung.id,
    disabled: !ziehbar,
  })

  return (
    <div ref={setNodeRef} className={clsx(isDragging && 'opacity-30')}>
      <KartenInhalt
        bewerbung={bewerbung}
        griff={
          ziehbar ? (
            <button
              type="button"
              className="-my-1 -mr-1 cursor-grab touch-none rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
              aria-label="Karte verschieben"
              {...listeners}
              {...attributes}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : undefined
        }
      />
    </div>
  )
}

function KartenInhalt({
  bewerbung,
  griff,
}: {
  bewerbung: BewerbungKurz
  griff?: React.ReactNode
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/bewerbungen/${bewerbung.id}`}
          className="min-w-0 flex-1 text-sm font-medium text-slate-900 hover:text-brand-700"
        >
          {vollerName(bewerbung.candidate)}
        </Link>
        {griff}
      </div>

      <p className="mt-0.5 truncate text-xs text-slate-500">
        {bewerbung.speculative
          ? t('bewerbungen.initiativ')
          : (bewerbung.job?.title ?? t('bewerbungen.ohneStelle'))}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {bewerbung.needsReview && <Badge ton="gelb">{t('bewerbungen.zuPruefen')}</Badge>}
        <BewertungAnzeige bewertung={bewerbung.bewertung} />
      </div>

      <div className="mt-2 flex items-center gap-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
        {(bewerbung._count?.documents ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Paperclip className="h-3 w-3" />
            {bewerbung._count?.documents}
          </span>
        )}
        {(bewerbung._count?.notes ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <StickyNote className="h-3 w-3" />
            {bewerbung._count?.notes}
          </span>
        )}
        <span className="ml-auto">{formatRelativ(bewerbung.appliedAt)}</span>
      </div>
    </article>
  )
}
