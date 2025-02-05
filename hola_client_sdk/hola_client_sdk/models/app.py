import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.app_health import AppHealth
from ..models.app_status import AppStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.app_environment import AppEnvironment


T = TypeVar("T", bound="App")


@_attrs_define
class App:
    """Application model shared between server and CLI.

    Represents a deployed application with its configuration, status, and metadata.

        Attributes:
            name (str): Unique application name
            status (Union[Unset, AppStatus]): Application status enumeration.
            health (Union[Unset, AppHealth]): Application health status enumeration.
            image (Union[None, Unset, str]): Container image used for the application
            port (Union[None, Unset, int]): Port the application is running on
            environment (Union[Unset, AppEnvironment]): Environment variables
            created_at (Union[None, Unset, datetime.datetime]): Application creation timestamp
            updated_at (Union[None, Unset, datetime.datetime]): Last update timestamp
            version (Union[None, Unset, str]): Application version
            description (Union[None, Unset, str]): Application description
            url (Union[None, Unset, str]): Application access URL
            backup_count (Union[None, Unset, int]): Number of available backups Default: 0.
            files_count (Union[Unset, int]): Number of application files Default: 0.
            files_total_size_bytes (Union[Unset, int]): Total size of application files in bytes Default: 0.
    """

    name: str
    status: Union[Unset, AppStatus] = UNSET
    health: Union[Unset, AppHealth] = UNSET
    image: Union[None, Unset, str] = UNSET
    port: Union[None, Unset, int] = UNSET
    environment: Union[Unset, "AppEnvironment"] = UNSET
    created_at: Union[None, Unset, datetime.datetime] = UNSET
    updated_at: Union[None, Unset, datetime.datetime] = UNSET
    version: Union[None, Unset, str] = UNSET
    description: Union[None, Unset, str] = UNSET
    url: Union[None, Unset, str] = UNSET
    backup_count: Union[None, Unset, int] = 0
    files_count: Union[Unset, int] = 0
    files_total_size_bytes: Union[Unset, int] = 0
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        status: Union[Unset, str] = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        health: Union[Unset, str] = UNSET
        if not isinstance(self.health, Unset):
            health = self.health.value

        image: Union[None, Unset, str]
        if isinstance(self.image, Unset):
            image = UNSET
        else:
            image = self.image

        port: Union[None, Unset, int]
        if isinstance(self.port, Unset):
            port = UNSET
        else:
            port = self.port

        environment: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        created_at: Union[None, Unset, str]
        if isinstance(self.created_at, Unset):
            created_at = UNSET
        elif isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        updated_at: Union[None, Unset, str]
        if isinstance(self.updated_at, Unset):
            updated_at = UNSET
        elif isinstance(self.updated_at, datetime.datetime):
            updated_at = self.updated_at.isoformat()
        else:
            updated_at = self.updated_at

        version: Union[None, Unset, str]
        if isinstance(self.version, Unset):
            version = UNSET
        else:
            version = self.version

        description: Union[None, Unset, str]
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        url: Union[None, Unset, str]
        if isinstance(self.url, Unset):
            url = UNSET
        else:
            url = self.url

        backup_count: Union[None, Unset, int]
        if isinstance(self.backup_count, Unset):
            backup_count = UNSET
        else:
            backup_count = self.backup_count

        files_count = self.files_count

        files_total_size_bytes = self.files_total_size_bytes

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if status is not UNSET:
            field_dict["status"] = status
        if health is not UNSET:
            field_dict["health"] = health
        if image is not UNSET:
            field_dict["image"] = image
        if port is not UNSET:
            field_dict["port"] = port
        if environment is not UNSET:
            field_dict["environment"] = environment
        if created_at is not UNSET:
            field_dict["created_at"] = created_at
        if updated_at is not UNSET:
            field_dict["updated_at"] = updated_at
        if version is not UNSET:
            field_dict["version"] = version
        if description is not UNSET:
            field_dict["description"] = description
        if url is not UNSET:
            field_dict["url"] = url
        if backup_count is not UNSET:
            field_dict["backup_count"] = backup_count
        if files_count is not UNSET:
            field_dict["files_count"] = files_count
        if files_total_size_bytes is not UNSET:
            field_dict["files_total_size_bytes"] = files_total_size_bytes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.app_environment import AppEnvironment

        d = dict(src_dict)
        name = d.pop("name")

        _status = d.pop("status", UNSET)
        status: Union[Unset, AppStatus]
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = AppStatus(_status)

        _health = d.pop("health", UNSET)
        health: Union[Unset, AppHealth]
        if isinstance(_health, Unset):
            health = UNSET
        else:
            health = AppHealth(_health)

        def _parse_image(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        image = _parse_image(d.pop("image", UNSET))

        def _parse_port(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        port = _parse_port(d.pop("port", UNSET))

        _environment = d.pop("environment", UNSET)
        environment: Union[Unset, AppEnvironment]
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = AppEnvironment.from_dict(_environment)

        def _parse_created_at(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_0 = isoparse(data)

                return created_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        created_at = _parse_created_at(d.pop("created_at", UNSET))

        def _parse_updated_at(data: object) -> Union[None, Unset, datetime.datetime]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                updated_at_type_0 = isoparse(data)

                return updated_at_type_0
            except:  # noqa: E722
                pass
            return cast(Union[None, Unset, datetime.datetime], data)

        updated_at = _parse_updated_at(d.pop("updated_at", UNSET))

        def _parse_version(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        version = _parse_version(d.pop("version", UNSET))

        def _parse_description(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_url(data: object) -> Union[None, Unset, str]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, str], data)

        url = _parse_url(d.pop("url", UNSET))

        def _parse_backup_count(data: object) -> Union[None, Unset, int]:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Union[None, Unset, int], data)

        backup_count = _parse_backup_count(d.pop("backup_count", UNSET))

        files_count = d.pop("files_count", UNSET)

        files_total_size_bytes = d.pop("files_total_size_bytes", UNSET)

        app = cls(
            name=name,
            status=status,
            health=health,
            image=image,
            port=port,
            environment=environment,
            created_at=created_at,
            updated_at=updated_at,
            version=version,
            description=description,
            url=url,
            backup_count=backup_count,
            files_count=files_count,
            files_total_size_bytes=files_total_size_bytes,
        )

        app.additional_properties = d
        return app

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
