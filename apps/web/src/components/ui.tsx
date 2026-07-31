import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { t } from '../i18n'

// --- Schaltflächen ----------------------------------------------------------

type ButtonVariante = 'primaer' | 'sekundaer' | 'still' | 'gefahr' | 'umriss'
type ButtonGroesse = 'sm' | 'md' | 'lg'

const varianten: Record<ButtonVariante, string> = {
  primaer: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  sekundaer: 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 shadow-sm',
  umriss: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100',
  still: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200',
  gefahr: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
}

const groessen: Record<ButtonGroesse, string> = {
  sm: 'h-8 px-2.5 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: ButtonVariante
  groesse?: ButtonGroesse
  laedt?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'primaer', groesse = 'md', laedt, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || laedt}
      className={clsx(
        'inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        varianten[variante],
        groessen[groesse],
        className,
      )}
      {...rest}
    >
      {laedt && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

// --- Eingabefelder ----------------------------------------------------------

const feldBasis =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 transition-colors hover:border-slate-400 ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

export interface FeldProps {
  label?: string
  hilfe?: ReactNode
  fehler?: string | null
  pflicht?: boolean
}

function FeldHuelle({
  label,
  hilfe,
  fehler,
  pflicht,
  htmlFor,
  children,
}: FeldProps & { htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      {label && (
        <label className="feld-label" htmlFor={htmlFor}>
          {label}
          {pflicht && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {fehler ? <p className="feld-fehler">{fehler}</p> : hilfe ? <p className="feld-hilfe">{hilfe}</p> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FeldProps>(
  function Input({ label, hilfe, fehler, pflicht, className, id, ...rest }, ref) {
    return (
      <FeldHuelle label={label} hilfe={hilfe} fehler={fehler} pflicht={pflicht} htmlFor={id}>
        <input
          ref={ref}
          id={id}
          aria-invalid={fehler ? true : undefined}
          className={clsx(feldBasis, 'h-10', fehler && 'border-red-400 focus:border-red-500', className)}
          {...rest}
        />
      </FeldHuelle>
    )
  },
)

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & FeldProps
>(function Textarea({ label, hilfe, fehler, pflicht, className, id, rows = 4, ...rest }, ref) {
  return (
    <FeldHuelle label={label} hilfe={hilfe} fehler={fehler} pflicht={pflicht} htmlFor={id}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={fehler ? true : undefined}
        className={clsx(feldBasis, 'py-2 leading-relaxed', fehler && 'border-red-400', className)}
        {...rest}
      />
    </FeldHuelle>
  )
})

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & FeldProps
>(function Select({ label, hilfe, fehler, pflicht, className, id, children, ...rest }, ref) {
  return (
    <FeldHuelle label={label} hilfe={hilfe} fehler={fehler} pflicht={pflicht} htmlFor={id}>
      <select ref={ref} id={id} className={clsx(feldBasis, 'h-10 pr-8', className)} {...rest}>
        {children}
      </select>
    </FeldHuelle>
  )
})

export function Checkbox({
  label,
  hilfe,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hilfe?: ReactNode }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5', className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-sm text-slate-700">{label}</span>
        {hilfe && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hilfe}</span>}
      </span>
    </label>
  )
}

// --- Anzeige ----------------------------------------------------------------

export function Karte({
  titel,
  beschreibung,
  aktion,
  className,
  children,
}: {
  titel?: ReactNode
  beschreibung?: ReactNode
  aktion?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={clsx('karte', className)}>
      {(titel || aktion) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            {titel && <h2 className="text-base font-semibold text-slate-900">{titel}</h2>}
            {beschreibung && <p className="mt-0.5 text-sm text-slate-500">{beschreibung}</p>}
          </div>
          {aktion && <div className="shrink-0">{aktion}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

type BadgeTon = 'grau' | 'blau' | 'gruen' | 'gelb' | 'rot' | 'lila'

const badgeToene: Record<BadgeTon, string> = {
  grau: 'bg-slate-100 text-slate-700 ring-slate-200',
  blau: 'bg-brand-50 text-brand-700 ring-brand-200',
  gruen: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  gelb: 'bg-amber-50 text-amber-800 ring-amber-200',
  rot: 'bg-red-50 text-red-700 ring-red-200',
  lila: 'bg-violet-50 text-violet-700 ring-violet-200',
}

export function Badge({
  ton = 'grau',
  className,
  children,
}: {
  ton?: BadgeTon
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeToene[ton],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-slate-400', className)} aria-hidden />
}

export function LadeZustand({ text }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <Spinner />
      {text ?? t('app.laedt')}
    </div>
  )
}

export function LeerZustand({
  titel,
  beschreibung,
  aktion,
  icon,
}: {
  titel: string
  beschreibung?: string
  aktion?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 text-slate-300">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{titel}</h3>
      {beschreibung && <p className="mt-1.5 max-w-md text-sm text-slate-500">{beschreibung}</p>}
      {aktion && <div className="mt-5">{aktion}</div>}
    </div>
  )
}

export function Hinweis({
  ton = 'info',
  titel,
  children,
}: {
  ton?: 'info' | 'warnung' | 'fehler' | 'erfolg'
  titel?: string
  children: ReactNode
}) {
  const toene = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warnung: 'border-amber-200 bg-amber-50 text-amber-900',
    fehler: 'border-red-200 bg-red-50 text-red-900',
    erfolg: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm', toene[ton])} role="status">
      {titel && <p className="mb-0.5 font-semibold">{titel}</p>}
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}

// --- Dialog -----------------------------------------------------------------

export function Dialog({
  offen,
  onSchliessen,
  titel,
  beschreibung,
  breite = 'md',
  fusszeile,
  children,
}: {
  offen: boolean
  onSchliessen: () => void
  titel: string
  beschreibung?: string
  breite?: 'sm' | 'md' | 'lg' | 'xl'
  fusszeile?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!offen) return
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSchliessen()
    }
    document.addEventListener('keydown', beiTaste)
    // Hintergrund darf nicht mitscrollen, solange der Dialog offen ist.
    const vorher = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', beiTaste)
      document.body.style.overflow = vorher
    }
  }, [offen, onSchliessen])

  if (!offen) return null

  const breiten = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-slate-900/40 animate-fade-in"
        onClick={onSchliessen}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        className={clsx(
          'relative z-10 my-auto w-full rounded-xl bg-white shadow-xl animate-slide-up',
          breiten[breite],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{titel}</h2>
            {beschreibung && <p className="mt-0.5 text-sm text-slate-500">{beschreibung}</p>}
          </div>
          <button
            type="button"
            onClick={onSchliessen}
            className="-mr-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={t('app.schliessen')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 duenner-scroll">{children}</div>
        {fusszeile && (
          <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
            {fusszeile}
          </footer>
        )}
      </div>
    </div>
  )
}

export function BestaetigenDialog({
  offen,
  onSchliessen,
  onBestaetigen,
  titel,
  text,
  bestaetigenText,
  laedt,
}: {
  offen: boolean
  onSchliessen: () => void
  onBestaetigen: () => void
  titel: string
  text: ReactNode
  bestaetigenText?: string
  laedt?: boolean
}) {
  return (
    <Dialog
      offen={offen}
      onSchliessen={onSchliessen}
      titel={titel}
      breite="sm"
      fusszeile={
        <>
          <Button variante="umriss" onClick={onSchliessen}>
            {t('app.abbrechen')}
          </Button>
          <Button variante="gefahr" onClick={onBestaetigen} laedt={laedt}>
            {bestaetigenText ?? t('app.loeschen')}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-slate-600">{text}</div>
    </Dialog>
  )
}
