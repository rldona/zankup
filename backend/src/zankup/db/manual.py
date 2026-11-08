"""Database objects created by hand in migrations, with no model counterpart (expression indexes).
Autogenerate and the models-vs-migrations test must leave them alone."""

MANUAL_INDEXES = frozenset({"ix_activities_search"})  # full-text search (OS-219)


def include_object(obj: object, name: str | None, type_: str, reflected: bool, compare_to: object) -> bool:
    return not (type_ == "index" and name in MANUAL_INDEXES)
