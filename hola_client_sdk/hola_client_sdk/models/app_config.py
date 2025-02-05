import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app_config_config import AppConfigConfig


T = TypeVar("T", bound="AppConfig")


@_attrs_define
class AppConfig:
    """Complete configuration for an application.

    Attributes:
        app_name (str): Name of the application
        created_at (datetime.datetime): When the configuration was created
        updated_at (datetime.datetime): When the configuration was last updated
        config (Union[Unset, AppConfigConfig]): Configuration entries
    """

    app_name: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    config: Union[Unset, "AppConfigConfig"] = UNSET

    def to_dict(self) -> dict[str, Any]:
        app_name = self.app_name

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        config: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.config, Unset):
            config = self.config.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(
            {
                "app_name": app_name,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )
        if config is not UNSET:
            field_dict["config"] = config

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app_config_config import AppConfigConfig

        d = dict(src_dict)
        app_name = d.pop("app_name")

        created_at = isoparse(d.pop("created_at"))

        updated_at = isoparse(d.pop("updated_at"))

        _config = d.pop("config", UNSET)
        config: Union[Unset, AppConfigConfig]
        if isinstance(_config, Unset):
            config = UNSET
        else:
            config = AppConfigConfig.from_dict(_config)

        app_config = cls(
            app_name=app_name,
            created_at=created_at,
            updated_at=updated_at,
            config=config,
        )

        return app_config
