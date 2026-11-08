import opensport_metrics


def test_version_is_set() -> None:
    assert opensport_metrics.__version__ == "0.1.0"
