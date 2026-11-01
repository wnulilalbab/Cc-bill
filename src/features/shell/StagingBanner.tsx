// A slim fixed banner on the staging build, so test data is never mistaken for the real thing.
export const STAGING_TEXT = 'Staging — test data'

export const isStaging = () => __APP_ENV__ === 'staging'

export function StagingBanner() {
  if (!isStaging()) return null
  return (
    <div className="stage" role="note" aria-label="Staging">
      {STAGING_TEXT} · v{__APP_VERSION__}
    </div>
  )
}
