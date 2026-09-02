# Motion reference video capability

Motion reference study always forwarded a prepared MP4 to the configured reviewer model. An explicit
reviewer setting could point to a text-only model, which rejected the request after the video had
already crossed the model boundary.

The study now sends the MP4 only to Google Gemini models. Other models receive the extracted stills
and an explicit prompt that timing must not be inferred from unseen video. A hard failure was
rejected because stills still provide a useful structural study.
