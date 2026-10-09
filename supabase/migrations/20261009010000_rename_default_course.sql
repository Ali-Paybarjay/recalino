-- ORG: the default course is now named "My Courses" (D51). Data only; no schema change.
-- Renames only the untouched old default name, and never one that would collide with a course
-- the learner already named "My Courses" (course names are unique per owner, case-insensitively).
update org.course as course
set name = 'My Courses'
where course.is_default
  and course.name = 'My classes'
  and not exists (
    select 1
    from org.course as other
    where other.owner_id = course.owner_id
      and lower(other.name) = 'my courses'
  );
