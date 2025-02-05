from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app_config import AppConfig


T = TypeVar("T", bound="ConfigResponse")


@_attrs_define
class ConfigResponse:
    """Response containing configuration data.

    Attributes:
        config (AppConfig): Complete configuration for an application.
        success (Union[Unset, bool]): Whether the operation was successful Default: True.
    """

    config: "AppConfig"
    success: Union[Unset, bool] = True

    def to_dict(self) -> dict[str, Any]:
        config = self.config.to_dict()

        success = self.success

        field_dict: dict[str, Any] = {}
        field_dict.update(
            {
                "config": config,
            }
        )
        if success is not UNSET:
            field_dict["success"] = success

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app_config import AppConfig

        d = dict(src_dict)
        config = AppConfig.from_dict(d.pop("config"))

        success = d.pop("success", UNSET)

        config_response = cls(
            config=config,
            success=success,
        )

        return config_response
