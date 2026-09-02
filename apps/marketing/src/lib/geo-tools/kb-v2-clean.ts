// @input  -- editor text as typed
// @output -- the trimmed, de-duplicated form the draft is saved in
// @pos    -- shared by the V2 editor and anything comparing against a saved draft
export const cleanGeoText = (value: string): string => value.trim().normalize("NFC");
export const cleanGeoList = (values: readonly string[]): readonly string[] => [...new Set(values.map(cleanGeoText).filter(Boolean))];
