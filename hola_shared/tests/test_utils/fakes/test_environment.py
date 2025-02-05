import pytest
import os
from hola_shared.test_utils.fakes.environment import FakeEnvironment


def test_fake_environment_initialization_empty():
    fake_env = FakeEnvironment()
    assert fake_env.vars == {}


def test_fake_environment_initialization_with_vars():
    initial = {"KEY1": "VALUE1", "KEY2": "VALUE2"}
    fake_env = FakeEnvironment(initial_vars=initial)
    assert fake_env.vars == initial
    # Ensure it's a copy
    initial["KEY3"] = "VALUE3"
    assert "KEY3" not in fake_env.vars


def test_fake_environment_get_existing_key():
    fake_env = FakeEnvironment({"MY_VAR": "my_value"})
    assert fake_env.get("MY_VAR") == "my_value"


def test_fake_environment_get_non_existing_key_no_default():
    fake_env = FakeEnvironment()
    assert fake_env.get("NON_EXISTENT") is None


def test_fake_environment_get_non_existing_key_with_default():
    fake_env = FakeEnvironment()
    assert fake_env.get("NON_EXISTENT", "default_val") == "default_val"


def test_fake_environment_set_new_key():
    fake_env = FakeEnvironment()
    fake_env.set("NEW_VAR", "new_value")
    assert fake_env.vars["NEW_VAR"] == "new_value"
    assert fake_env.get("NEW_VAR") == "new_value"


def test_fake_environment_set_overwrite_key():
    fake_env = FakeEnvironment({"MY_VAR": "initial_value"})
    fake_env.set("MY_VAR", "updated_value")
    assert fake_env.vars["MY_VAR"] == "updated_value"


def test_fake_environment_update():
    fake_env = FakeEnvironment({"VAR1": "VAL1"})
    fake_env.update({"VAR2": "VAL2", "VAR1": "NEW_VAL1"})
    assert fake_env.vars == {"VAR1": "NEW_VAL1", "VAR2": "VAL2"}


def test_fake_environment_delete_existing_key():
    fake_env = FakeEnvironment({"TO_DELETE": "value"})
    fake_env.delete("TO_DELETE")
    assert "TO_DELETE" not in fake_env.vars


def test_fake_environment_delete_non_existing_key():
    fake_env = FakeEnvironment()
    fake_env.delete("NON_EXISTENT")  # Should not raise error
    assert "NON_EXISTENT" not in fake_env.vars


def test_fake_environment_reset():
    fake_env = FakeEnvironment({"VAR1": "VAL1"})
    fake_env.reset()
    assert fake_env.vars == {}


def test_fake_environment_context_manager():
    original_os_environ = os.environ.copy()
    fake_initial_vars = {"CTX_VAR": "ctx_value", "OTHER_VAR": "other"}

    # Set a var that will be overwritten by the context manager
    os.environ["CTX_VAR"] = "original_os_value"
    # Set a var that should be preserved after exit
    os.environ["PRESERVED_OS_VAR"] = "preserved_os_value"

    try:
        with FakeEnvironment(initial_vars=fake_initial_vars) as fake_env_ctx:
            # Inside context: os.environ should match fake_env_ctx.vars
            assert os.environ["CTX_VAR"] == "ctx_value"
            assert os.environ["OTHER_VAR"] == "other"
            assert (
                "PRESERVED_OS_VAR" not in os.environ
            )  # It was cleared and not in fake_initial_vars

            # Modify os.environ inside context, should reflect in fake_env_ctx if it also updates its internal vars
            # The current FakeEnvironment context manager replaces os.environ, it doesn't sync back.
            # So, changes to os.environ directly won't affect fake_env_ctx.vars
            os.environ["NEW_INSIDE_CTX"] = "new_inside"
            assert "NEW_INSIDE_CTX" in os.environ
            assert (
                "NEW_INSIDE_CTX" not in fake_env_ctx.vars
            )  # As per current implementation

            # Modify fake_env_ctx.vars, should not affect os.environ directly unless re-applied
            fake_env_ctx.set("MODIFIED_CTX_VAR", "modified_ctx_val")
            assert "MODIFIED_CTX_VAR" in fake_env_ctx.vars
            assert "MODIFIED_CTX_VAR" not in os.environ  # As per current implementation

        # Outside context: os.environ should be restored
        assert os.environ["CTX_VAR"] == "original_os_value"
        assert "OTHER_VAR" not in os.environ  # Was not in original_os_environ
        assert os.environ["PRESERVED_OS_VAR"] == "preserved_os_value"
        assert (
            "NEW_INSIDE_CTX" not in os.environ
        )  # Changes made to os.environ inside are gone

    finally:
        # Ensure os.environ is fully restored to its original state before the test
        os.environ.clear()
        os.environ.update(original_os_environ)


def test_fake_environment_dict_access():
    fake_env = FakeEnvironment({"KEY": "VALUE"})
    assert fake_env["KEY"] == "VALUE"

    fake_env["NEW_KEY"] = "NEW_VALUE"
    assert fake_env.get("NEW_KEY") == "NEW_VALUE"

    assert "KEY" in fake_env
    del fake_env["KEY"]
    assert "KEY" not in fake_env

    with pytest.raises(KeyError):
        _ = fake_env["NON_EXISTENT_KEY"]


# To ensure full cleanup if a test fails mid-context
@pytest.fixture(autouse=True)
def ensure_os_environ_cleanup():
    original_os_environ = os.environ.copy()
    yield
    os.environ.clear()
    os.environ.update(original_os_environ)
