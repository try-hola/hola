import pytest
from hola_shared.test_utils.fakes.logging import FakeLogger, LogMessage
import logging


def test_fake_logger_initialization():
    logger = FakeLogger(name="test_logger")
    assert logger.name == "test_logger"
    assert len(logger.messages) == 0


def test_fake_logger_log_levels():
    logger = FakeLogger()
    logger.debug("debug message")
    logger.info("info message")
    logger.warning("warning message")
    logger.error("error message")
    logger.critical("critical message")

    assert len(logger.messages) == 5
    assert logger.messages[0].levelname == "DEBUG"
    assert logger.messages[0].message == "debug message"
    assert logger.messages[1].levelname == "INFO"
    assert logger.messages[1].message == "info message"
    assert logger.messages[2].levelname == "WARNING"
    assert logger.messages[2].message == "warning message"
    assert logger.messages[3].levelname == "ERROR"
    assert logger.messages[3].message == "error message"
    assert logger.messages[4].levelname == "CRITICAL"
    assert logger.messages[4].message == "critical message"


def test_fake_logger_log_with_args_kwargs():
    logger = FakeLogger()
    logger.info(
        "info message with %s and %s", "arg1", "arg2", extra_kwarg="extra_value"
    )
    assert len(logger.messages) == 1
    msg = logger.messages[0]
    assert msg.message == "info message with %s and %s"
    assert msg.args == ("arg1", "arg2")
    assert msg.kwargs == {"extra_kwarg": "extra_value"}


def test_fake_logger_exception():
    logger = FakeLogger()
    try:
        raise ValueError("test exception")
    except ValueError:
        logger.exception("exception occurred")

    assert len(logger.messages) == 1
    msg = logger.messages[0]
    assert msg.levelname == "ERROR"
    assert msg.message == "exception occurred"
    assert msg.kwargs.get("exc_info") is True


def test_fake_logger_get_messages_no_filter():
    logger = FakeLogger()
    logger.info("info1")
    logger.debug("debug1")
    assert len(logger.get_messages()) == 2


def test_fake_logger_get_messages_filtered_by_level():
    logger = FakeLogger()
    logger.info("info1")
    logger.debug("debug1")
    logger.info("info2")

    info_messages = logger.get_messages(level="INFO")
    assert len(info_messages) == 2
    assert all(msg.levelname == "INFO" for msg in info_messages)
    assert info_messages[0].message == "info1"
    assert info_messages[1].message == "info2"

    debug_messages = logger.get_messages(level="DEBUG")
    assert len(debug_messages) == 1
    assert debug_messages[0].levelname == "DEBUG"
    assert debug_messages[0].message == "debug1"

    warning_messages = logger.get_messages(level="WARNING")
    assert len(warning_messages) == 0


def test_fake_logger_get_messages_invalid_level():
    logger = FakeLogger()
    with pytest.raises(ValueError, match="Invalid log level: NONEXISTENTLEVEL"):
        logger.get_messages(level="NONEXISTENTLEVEL")


def test_fake_logger_reset():
    logger = FakeLogger()
    logger.info("some message")
    assert len(logger.messages) == 1
    logger.reset()
    assert len(logger.messages) == 0


def test_fake_logger_has_message():
    logger = FakeLogger()
    logger.info("test info message")
    logger.error("test error message")

    assert logger.has_message("test info", "INFO")
    assert logger.has_message("error message", "ERROR")
    assert not logger.has_message("missing message")
    # Level-specific checks
    assert logger.has_message("test info", level="INFO")
    assert not logger.has_message("test info", level="ERROR")


def test_fake_logger_record_tuples():
    """Test the record_tuples property which returns (logger_name, level, message) tuples."""
    logger = FakeLogger("test_logger")
    logger.info("test message")
    logger.error("error %s", "details")

    tuples = logger.record_tuples
    assert len(tuples) == 2
    assert tuples[0] == ("test_logger", logging.INFO, "test message")
    assert tuples[1] == ("test_logger", logging.ERROR, "error details")


def test_fake_logger_complex_formatting():
    """Test more complex message formatting scenarios."""
    logger = FakeLogger()

    # Test with multiple positional args
    logger.info("Value: %d, String: %s, Float: %.2f", 42, "test", 3.14159)

    # Test with both args and kwargs
    logger.debug("Message: %s", "test", extra={"context": "test"})

    messages = logger.get_messages()
    assert len(messages) == 2

    # Check first message formatting
    assert messages[0].args == (42, "test", 3.14159)

    # Check second message
    assert messages[1].args == ("test",)
    assert messages[1].kwargs["extra"] == {"context": "test"}


def test_fake_logger_interface_methods():
    """Test the additional Logger interface methods."""
    logger = FakeLogger()

    # Test isEnabledFor
    assert logger.isEnabledFor(logging.DEBUG) is True
    assert logger.isEnabledFor(logging.INFO) is True

    # Test getEffectiveLevel
    assert logger.getEffectiveLevel() == logging.DEBUG

    # Test handler methods (should not raise)
    dummy_handler = logging.StreamHandler()
    logger.addHandler(dummy_handler)
    logger.removeHandler(dummy_handler)

    # Test setLevel (should not affect behavior of fake logger)
    logger.setLevel(logging.INFO)
    logger.debug("Should still be captured")
    assert len(logger.get_messages("DEBUG")) == 1


def test_logmessage_representation():
    log_msg = LogMessage(logging.INFO, "Test info", (), {})
    assert repr(log_msg) == "LogMessage(level=INFO, message='Test info')"
    log_msg_debug = LogMessage(logging.DEBUG, "Test debug with %s", ("arg",), {})
    assert (
        repr(log_msg_debug) == "LogMessage(level=DEBUG, message='Test debug with %s')"
    )
