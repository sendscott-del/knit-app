-- 20260602080000_knit_backfill_es_labels.sql
-- Spanish translations for the seed interest tags and participation styles.
-- The columns name_es / label_es already existed but were null. With these
-- populated, the EN/ES toggle finally swaps the data-driven chips on
-- /me onboarding, /admin/members, and /admin/friends. Translations match
-- the warm, plain register the rest of the app uses; LDS-canonical
-- vocabulary where it applies.

UPDATE knit_interest_tags SET name_es = CASE name_en
  -- hobby
  WHEN 'Art' THEN 'Arte'
  WHEN 'Baking' THEN 'Repostería'
  WHEN 'Board games' THEN 'Juegos de mesa'
  WHEN 'Cooking' THEN 'Cocinar'
  WHEN 'Crafts' THEN 'Manualidades'
  WHEN 'DIY / Fixing things' THEN 'Bricolaje / Reparaciones'
  WHEN 'Gardening' THEN 'Jardinería'
  WHEN 'Movies' THEN 'Películas'
  WHEN 'Music' THEN 'Música'
  WHEN 'Photography' THEN 'Fotografía'
  WHEN 'Reading' THEN 'Lectura'
  WHEN 'Video games' THEN 'Videojuegos'
  WHEN 'Writing' THEN 'Escritura'
  -- sport
  WHEN 'Baseball' THEN 'Béisbol'
  WHEN 'Basketball' THEN 'Baloncesto'
  WHEN 'Cycling' THEN 'Ciclismo'
  WHEN 'Fishing' THEN 'Pesca'
  WHEN 'Golf' THEN 'Golf'
  WHEN 'Hiking' THEN 'Senderismo'
  WHEN 'Pickleball' THEN 'Pickleball'
  WHEN 'Running' THEN 'Correr'
  WHEN 'Soccer' THEN 'Fútbol'
  WHEN 'Swimming' THEN 'Natación'
  WHEN 'Tennis' THEN 'Tenis'
  WHEN 'Ultimate frisbee' THEN 'Frisbee'
  WHEN 'Weightlifting' THEN 'Levantamiento de pesas'
  WHEN 'Yoga' THEN 'Yoga'
  -- life_stage
  WHEN 'College student' THEN 'Estudiante universitario'
  WHEN 'Empty nester' THEN 'Hijos ya fuera de casa'
  WHEN 'Newly married' THEN 'Recién casado'
  WHEN 'Parent of teens' THEN 'Padre de adolescentes'
  WHEN 'Parent of young kids' THEN 'Padre de niños pequeños'
  WHEN 'Retired' THEN 'Jubilado'
  WHEN 'Young adult' THEN 'Adulto joven'
  -- profession
  WHEN 'Arts / Creative' THEN 'Artes / Creativo'
  WHEN 'Business / Finance' THEN 'Negocios / Finanzas'
  WHEN 'Engineer' THEN 'Ingeniero'
  WHEN 'Nurse / Medical' THEN 'Enfermero / Médico'
  WHEN 'Stay-at-home parent' THEN 'Padre a tiempo completo'
  WHEN 'Teacher' THEN 'Maestro'
  WHEN 'Trades / Construction' THEN 'Oficios / Construcción'
  -- culture
  WHEN 'African' THEN 'Africano'
  WHEN 'Asian' THEN 'Asiático'
  WHEN 'Brazilian' THEN 'Brasileño'
  WHEN 'European' THEN 'Europeo'
  WHEN 'Filipino' THEN 'Filipino'
  WHEN 'Latin American' THEN 'Latinoamericano'
  WHEN 'Polynesian' THEN 'Polinesio'
  WHEN 'Spanish-speaking' THEN 'Hispanohablante'
  ELSE name_es
END
WHERE name_es IS NULL;

UPDATE knit_participation_styles SET label_es = CASE key
  WHEN 'attend_lesson' THEN 'Acompañar en una lección'
  WHEN 'give_ride' THEN 'Dar un aventón'
  WHEN 'host_meal' THEN 'Invitar a una comida'
  WHEN 'invite_to_activity' THEN 'Invitar a un amigo a una actividad'
  WHEN 'share_testimony' THEN 'Compartir mi testimonio'
  WHEN 'take_to_event' THEN 'Llevar a un amigo a un evento'
  WHEN 'teach_skill' THEN 'Compartir una habilidad que tengo'
  ELSE label_es
END
WHERE label_es IS NULL;
