from unittest.mock import MagicMock, patch

import pytest


class TestPytestAddoption:
    def test_registers_smart_reporter_flag(self):
        from playwright_smart_reporter_python.plugin import pytest_addoption

        mock_group = MagicMock()
        mock_parser = MagicMock()
        mock_parser.getgroup.return_value = mock_group

        pytest_addoption(mock_parser)

        mock_parser.getgroup.assert_called_once_with("smart-reporter")
        calls = mock_group.addoption.call_args_list
        assert len(calls) == 2

        flag_names = [call[0][0] for call in calls]
        assert "--smart-reporter" in flag_names
        assert "--smart-reporter-output" in flag_names

    def test_smart_reporter_flag_defaults_false(self):
        from playwright_smart_reporter_python.plugin import pytest_addoption

        mock_group = MagicMock()
        mock_parser = MagicMock()
        mock_parser.getgroup.return_value = mock_group

        pytest_addoption(mock_parser)

        sr_call = [
            c for c in mock_group.addoption.call_args_list
            if c[0][0] == "--smart-reporter"
        ][0]
        assert sr_call[1]["default"] is False
        assert sr_call[1]["action"] == "store_true"


class TestPytestConfigure:
    def test_skips_when_flag_not_set(self):
        from playwright_smart_reporter_python.plugin import pytest_configure

        mock_config = MagicMock()
        mock_config.getoption.return_value = False

        pytest_configure(mock_config)

        mock_config.pluginmanager.register.assert_not_called()

    def test_registers_plugin_when_flag_set(self):
        from playwright_smart_reporter_python.plugin import pytest_configure

        mock_config = MagicMock()
        mock_config.getoption.side_effect = lambda opt, **kw: {
            "--smart-reporter": True,
            "--smart-reporter-output": "smart-report.html",
        }.get(opt, kw.get("default"))
        mock_config.option = MagicMock(spec=[])

        pytest_configure(mock_config)

        mock_config.pluginmanager.register.assert_called_once()
        registered_plugin = mock_config.pluginmanager.register.call_args[0][0]
        assert registered_plugin.__class__.__name__ == "SmartReporterPlugin"
