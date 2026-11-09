# AI evaluation set (OS-707)

`cases.json` holds the questions the Coach must answer and the activities to summarise, in English and
Spanish: 10 summaries (the latest activity of each sport) and 36 questions. There are no expected
answers written down, because they depend on the database the set runs against: the check is that
**every number the model quotes exists in the data it was given** (the activity's context, or the
tools' results), that the expected tools were called, and that an answer contains one of a few
expected words.

Run it against your own data before changing a prompt or the model:

```bash
uv run python -m zankup.ai.eval                # everything
uv run python -m zankup.ai.eval --language es --only coach --limit 5
```

It needs `DATABASE_URL` and `ANTHROPIC_API_KEY`, and costs a few cents on the small model; the calls
are recorded in `llm_calls` with the purpose `eval`. Nothing here is personal data.
